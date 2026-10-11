/**
 * LocalRuntime: an in-browser emulator of the Convex backend.
 *
 * It loads the real Convex function modules (`src/convex/*.ts`), and runs their
 * handlers against an in-memory database with transactions, a scheduler, crons,
 * reactive subscriptions, localStorage persistence and cross-tab sync.
 *
 * Roles: exactly one tab is the LEADER. It owns the writable state and executes all
 * mutations, actions, scheduled functions and crons. Other tabs are FOLLOWERS: they keep
 * a replica (updated through BroadcastChannel commit messages), run queries locally and
 * forward mutations/actions to the leader over the same channel.
 */
import { getFunctionName } from 'convex/server';
import { ConvexError, jsonToConvex } from 'convex/values';
import { makeDb } from './db.js';
import { startElection, type Election, type LocksLike } from './election.js';
import { nextRun, type CronSpec } from './crons.js';
import type { ChannelFactory, ChannelLike, RefLike, StorageLike } from './platform.js';
import {
	SCHEDULED_TABLE,
	Store,
	Tx,
	type Doc,
	type IndexDef,
	type StoreSnapshot,
	type TxEnv,
	type WriteSet
} from './store.js';
import { makeId, tableOfId } from './ids.js';
import { validateValue, type ValidatorJson } from './validate.js';
import { cloneValue, stableKey, valuesEqual } from './values.js';

/* --------------------------------- options -------------------------------- */

export type ModuleLike = Record<string, unknown>;
export type ModuleSource = ModuleLike | (() => Promise<ModuleLike>);
/** Module path/name -> module (or lazy loader). Keys like `../../convex/auth.ts` or `auth`. */
export type ModuleMap = Record<string, ModuleSource>;

export interface LocalRuntimeOptions {
	modules: ModuleMap;
	/** Override the schema (default: default export of the `schema` module). */
	schema?: unknown;
	/** Override the crons (default: default export of the `crons` module). */
	crons?: unknown;
	/** localStorage-like. `null` disables persistence. */
	storage?: StorageLike | null;
	storageKey?: string;
	/** Factory for the cross-tab channel. `null` disables cross-tab sync. */
	createChannel?: ChannelFactory | null;
	channelName?: string;
	/** `navigator.locks`-like. */
	locks?: LocksLike | null;
	/** 'always': skip election, this runtime is the sole leader (tests, SSR-less single tab). */
	leader?: 'auto' | 'always';
	/** process.env values visible to Convex functions. */
	env?: Record<string, string>;
	persistDebounceMs?: number;
	validateArgs?: boolean;
	validateDocs?: boolean;
	/** Run scheduled functions and crons (leader only). Default true. */
	runScheduled?: boolean;
	/** Module names (without extension) to skip, in addition to the built-in rules. */
	exclude?: (name: string) => boolean;
	log?: (level: 'info' | 'warn' | 'error', ...args: unknown[]) => void;
	/**
	 * Runs once at the end of boot (after the role is known); `ready` waits for it.
	 * `mutation` here does not wait for `ready` (that would deadlock).
	 */
	afterBoot?: (api: BootApi) => Promise<void>;
}

export interface BootApi {
	role: 'leader' | 'follower';
	hasFunction(ref: RefLike): boolean;
	mutation(ref: RefLike, args?: unknown): Promise<unknown>;
}

/* ------------------------------ function registry ------------------------------ */

type Kind = 'query' | 'mutation' | 'action';

interface FnEntry {
	name: string;
	kind: Kind;
	isPublic: boolean;
	handler: (ctx: unknown, args: unknown) => unknown;
	exportArgs: () => string;
	validator?: ValidatorJson | null;
}

export function normalizeModuleName(key: string): string {
	let k = key.replace(/\\/g, '/');
	const i = k.lastIndexOf('/convex/');
	if (i >= 0) k = k.slice(i + '/convex/'.length);
	else k = k.replace(/^(\.\/|\.\.\/)+/, '');
	return k.replace(/\.(ts|js|mjs|cjs)$/, '');
}

/** Files that must never run in the browser runtime. */
export function isExcludedModule(name: string): boolean {
	const base = name.split('/').pop() ?? name;
	return (
		name.startsWith('_generated/') ||
		name === 'auth.config' ||
		/\.(test|spec)$/.test(base) ||
		/\.d$/.test(base) ||
		base === 'tempoNode' ||
		/Node$/.test(base) ||
		name.startsWith('node_modules/')
	);
}

function toFunctionName(ref: RefLike): string {
	let name: string;
	if (typeof ref === 'string') name = ref;
	else name = getFunctionName(ref as never);
	if (!name.includes(':')) name = `${name}:default`;
	return name;
}

/* ------------------------------ helper types ------------------------------ */

interface Listener {
	cb: (value: unknown) => void;
	errCb?: (error: Error) => void;
}
type SubResult = { ok: true; value: unknown; cloned?: unknown } | { ok: false; error: Error };
interface Sub {
	key: string;
	entry: FnEntry;
	args: Record<string, unknown>;
	listeners: Set<Listener>;
	result?: SubResult;
	readTables: Set<string>;
	running: boolean;
	dirty: boolean;
}

interface RpcMessage {
	t: 'rpc';
	from: string;
	id: string;
	kind: Kind | 'reset';
	name: string;
	args: unknown;
}

interface SerializedError {
	message: string;
	name: string;
	stack?: string;
	convexData?: unknown;
	isConvex?: boolean;
}

function serializeError(e: unknown): SerializedError {
	if (e instanceof ConvexError) {
		return { message: e.message, name: e.name, isConvex: true, convexData: e.data };
	}
	if (e instanceof Error) return { message: e.message, name: e.name, stack: e.stack };
	return { message: String(e), name: 'Error' };
}

function deserializeError(s: SerializedError): Error {
	if (s.isConvex) return new ConvexError(s.convexData as never);
	const e = new Error(s.message);
	e.name = s.name;
	if (s.stack) e.stack = s.stack;
	return e;
}

const MAX_TIMEOUT = 2 ** 30;
const DEFAULT_KEY = 'portunus.localdb.v1';
const DEFAULT_CHANNEL = 'portunus-localdb';

/* --------------------------------- runtime --------------------------------- */

export class LocalRuntime {
	readonly store = new Store();
	readonly tabId = `tab_${Math.random().toString(36).slice(2, 10)}`;
	role: 'pending' | 'leader' | 'follower' = 'pending';
	readonly ready: Promise<void>;
	/** Names of all registered functions (for diagnostics). */
	functions = new Map<string, FnEntry>();

	private o: LocalRuntimeOptions;
	private schemaTables: Record<string, { validator?: { json: unknown }; indexes: Array<{ indexDescriptor: string; fields: string[] }> }> = {};
	private cronSpecs: Record<string, CronSpec> = {};
	private env: TxEnv;
	private queue: Promise<unknown> = Promise.resolve();
	private subs = new Map<string, Sub>();
	private dirtyTables = new Set<string>();
	private notifyScheduled = false;
	private channel: ChannelLike | null = null;
	private election: Election | null = null;
	private persistTimer: ReturnType<typeof setTimeout> | null = null;
	private persistFirstPending = 0;
	private wakeTimer: ReturnType<typeof setTimeout> | null = null;
	private wakeAt = Infinity;
	private inflight = new Set<string>();
	private pendingRpc = new Map<string, { msg: RpcMessage; resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	private handledRpc = new Map<string, Promise<{ ok: boolean; value?: unknown; error?: SerializedError }>>();
	private disposed = false;
	private lastPrune = 0;
	private unloadHandler: (() => void) | null = null;
	private persistWarned = false;

	constructor(options: LocalRuntimeOptions) {
		this.o = options;
		this.env = {
			registry: this.store.registry,
			indexesFor: (table) => this.indexesFor(table),
			newId: (table) => makeId(this.store.registry, table),
			newCreationTime: () => this.store.newCreationTime(),
			validateDoc: options.validateDocs === false ? undefined : (t, f) => this.validateDoc(t, f)
		};
		this.ready = this.init();
		// Surface init failures through ready, but never as unhandled rejections.
		this.ready.catch(() => {});
	}

	/* ------------------------------- boot ------------------------------- */

	private log(level: 'info' | 'warn' | 'error', ...args: unknown[]) {
		if (this.o.log) this.o.log(level, ...args);
		else if (level !== 'info') console[level]('[portunus local backend]', ...args);
	}

	private installEnv() {
		const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
		if (!g.process) g.process = { env: {} };
		if (!g.process.env) g.process.env = {};
		const env = { TEMPO_MODE: 'sim', ...(this.o.env ?? {}) };
		for (const [k, v] of Object.entries(env)) {
			// Only fill gaps, except TEMPO_MODE: the local runtime is always sim.
			if (g.process.env[k] === undefined || k === 'TEMPO_MODE') g.process.env[k] = v;
		}
	}

	private async init() {
		if (typeof window !== 'undefined') {
			(window as unknown as { __convexAllowFunctionsInBrowser?: boolean }).__convexAllowFunctionsInBrowser = true;
		}
		this.installEnv();

		// Load modules.
		const loaded: Array<[string, ModuleLike]> = [];
		await Promise.all(
			Object.entries(this.o.modules).map(async ([key, src]) => {
				const name = normalizeModuleName(key);
				if (isExcludedModule(name) || this.o.exclude?.(name)) return;
				try {
					const mod = typeof src === 'function' ? await src() : src;
					loaded.push([name, mod]);
				} catch (e) {
					this.log('warn', `Skipping module "${name}" (failed to load):`, e);
				}
			})
		);
		loaded.sort((a, b) => (a[0] < b[0] ? -1 : 1));

		let schema: unknown = this.o.schema;
		let crons: unknown = this.o.crons;
		for (const [name, mod] of loaded) {
			if (name === 'schema') {
				schema ??= mod.default;
				continue;
			}
			if (name === 'crons') {
				crons ??= mod.default;
				continue;
			}
			for (const [exp, value] of Object.entries(mod)) {
				if (typeof value !== 'function') continue;
				const fn = value as unknown as {
					isQuery?: boolean;
					isMutation?: boolean;
					isAction?: boolean;
					isPublic?: boolean;
					_handler?: FnEntry['handler'];
					exportArgs?: () => string;
				};
				if (!fn._handler) continue;
				const kind: Kind | null = fn.isQuery ? 'query' : fn.isMutation ? 'mutation' : fn.isAction ? 'action' : null;
				if (!kind) continue;
				const fname = `${name}:${exp}`;
				this.functions.set(fname, {
					name: fname,
					kind,
					isPublic: !!fn.isPublic,
					handler: fn._handler,
					exportArgs: fn.exportArgs ?? (() => JSON.stringify({ type: 'any' }))
				});
			}
		}

		const sch = schema as { tables?: LocalRuntime['schemaTables'] } | undefined;
		if (sch?.tables) this.schemaTables = sch.tables;
		const cr = crons as { crons?: Record<string, CronSpec> } | undefined;
		if (cr?.crons) this.cronSpecs = cr.crons;

		this.store.ensureTables([...Object.keys(this.schemaTables), SCHEDULED_TABLE]);

		// Persisted state.
		this.loadFromStorage();

		// Cross-tab channel + election.
		const factory = this.o.createChannel === undefined ? null : this.o.createChannel;
		if (factory && this.o.leader !== 'always') {
			this.channel = factory(this.o.channelName ?? DEFAULT_CHANNEL);
			if (this.channel) this.channel.onmessage = (ev) => this.onMessage(ev.data as Record<string, unknown>);
		} else if (factory) {
			// leader 'always' but still publish commits so followers can replicate (used in tests).
			this.channel = factory(this.o.channelName ?? DEFAULT_CHANNEL);
			if (this.channel) this.channel.onmessage = (ev) => this.onMessage(ev.data as Record<string, unknown>);
		}

		if (this.o.leader === 'always' || !this.channel) {
			this.role = 'leader';
		} else {
			this.channel.postMessage({ t: 'hello', from: this.tabId, seq: this.store.seq });
			this.election = startElection({
				name: this.o.channelName ?? DEFAULT_CHANNEL,
				tabId: this.tabId,
				locks: this.o.locks,
				storage: this.o.storage,
				onLeader: () => this.becomeLeader()
			});
			const isLeader = await this.election.initial;
			this.role = isLeader ? 'leader' : 'follower';
		}

		this.installUnloadHandler();
		if (this.role === 'leader') this.onLeaderStart();

		if (this.o.afterBoot) {
			try {
				await this.o.afterBoot({
					role: this.role as 'leader' | 'follower',
					hasFunction: (ref) => this.hasFunction(ref),
					mutation: (ref, args) => this.mutationNow(ref, args)
				});
			} catch (e) {
				this.log('error', 'afterBoot failed', e);
			}
		}
	}

	private installUnloadHandler() {
		const g = globalThis as { addEventListener?: (t: string, cb: () => void) => void };
		if (typeof g.addEventListener !== 'function' || !this.o.storage) return;
		this.unloadHandler = () => {
			this.flush();
			this.election?.stop();
		};
		g.addEventListener('pagehide', this.unloadHandler);
	}

	private onLeaderStart() {
		this.channel?.postMessage({ t: 'leader', from: this.tabId });
		if (this.o.runScheduled !== false) {
			void this.pruneJobs();
			this.tick();
		}
	}

	private becomeLeader() {
		if (this.disposed || this.role === 'leader') return;
		this.role = 'leader';
		this.onLeaderStart();
		// Re-run RPCs that were waiting on the previous leader.
		const waiting = [...this.pendingRpc.values()];
		this.pendingRpc.clear();
		for (const p of waiting) {
			void this.execRpc(p.msg).then((r) => (r.ok ? p.resolve(r.value) : p.reject(deserializeError(r.error!))));
		}
	}

	/* ------------------------------ persistence ------------------------------ */

	private get storageKey() {
		return this.o.storageKey ?? DEFAULT_KEY;
	}

	private loadFromStorage() {
		const storage = this.o.storage;
		if (!storage) return;
		try {
			const raw = storage.getItem(this.storageKey);
			if (!raw) return;
			const snap = JSON.parse(raw) as StoreSnapshot;
			if (snap?.v !== 1) return;
			this.store.loadSnapshot(snap);
		} catch (e) {
			this.log('warn', 'Could not read persisted local database, starting empty.', e);
		}
	}

	private schedulePersist() {
		if (!this.o.storage || this.role !== 'leader' || this.disposed) return;
		const delay = this.o.persistDebounceMs ?? 250;
		const now = Date.now();
		if (!this.persistFirstPending) this.persistFirstPending = now;
		if (this.persistTimer) clearTimeout(this.persistTimer);
		// Trailing debounce, but never starve longer than 2s.
		const wait = Math.max(0, Math.min(delay, this.persistFirstPending + 2000 - now));
		this.persistTimer = setTimeout(() => this.flush(), wait);
	}

	/** Write the snapshot to storage now (leader only). */
	flush() {
		if (this.persistTimer) clearTimeout(this.persistTimer);
		this.persistTimer = null;
		this.persistFirstPending = 0;
		const storage = this.o.storage;
		if (!storage || this.role !== 'leader') return;
		try {
			storage.setItem(this.storageKey, JSON.stringify(this.store.toSnapshot()));
		} catch (e) {
			if (!this.persistWarned) {
				this.persistWarned = true;
				this.log('warn', 'Could not persist the local database (storage full or blocked). Changes are kept in memory only.', e);
			}
		}
	}

	/* ------------------------------ schema helpers ------------------------------ */

	private indexesFor(table: string): IndexDef[] {
		const t = this.schemaTables[table];
		return t ? t.indexes.map((i) => ({ name: i.indexDescriptor, fields: i.fields })) : [];
	}

	private validateDoc(table: string, fields: Record<string, unknown>) {
		const t = this.schemaTables[table];
		if (!t?.validator) return;
		const err = validateValue(t.validator.json as ValidatorJson, fields, {
			tableOfId: (id) => tableOfId(this.store.registry, id)
		});
		if (err) throw new Error(`Document in table "${table}" does not match the schema: ${err}`);
	}

	/* ------------------------------ function lookup ------------------------------ */

	private lookup(ref: RefLike, kind: Kind | null, publicOnly: boolean): FnEntry {
		const name = toFunctionName(ref);
		const entry = this.functions.get(name);
		if (!entry || (publicOnly && !entry.isPublic)) {
			throw new Error(
				`Could not find ${publicOnly ? 'public ' : ''}function for '${name}'. Did you forget to run \`npx convex dev\` or \`npx convex deploy\`?`
			);
		}
		if (kind && entry.kind !== kind) {
			throw new Error(`Function ${name} is a ${entry.kind}, not a ${kind}.`);
		}
		return entry;
	}

	private checkArgs(entry: FnEntry, args: unknown): Record<string, unknown> {
		const a = (args === undefined ? {} : cloneValue(args)) as Record<string, unknown>;
		if (this.o.validateArgs === false) return a;
		if (entry.validator === undefined) {
			try {
				entry.validator = JSON.parse(entry.exportArgs()) as ValidatorJson;
			} catch {
				entry.validator = null;
			}
		}
		const v = entry.validator;
		if (v && v.type !== 'any') {
			const err = validateValue(v, a, { tableOfId: (id) => tableOfId(this.store.registry, id) });
			if (err) throw new Error(`ArgumentValidationError in ${entry.name}: ${err}`);
		}
		return a;
	}

	/* ------------------------------ execution ------------------------------ */

	private baseCtx() {
		return {
			auth: {
				getUserIdentity: async () => null
			},
			storage: new Proxy(
				{},
				{
					get: () => () => {
						throw new Error('File storage is not available in the local runtime.');
					}
				}
			)
		};
	}

	private async invoke(entry: FnEntry, ctx: unknown, args: Record<string, unknown>) {
		const result = await Promise.resolve(entry.handler(ctx, args));
		return cloneValue(result === undefined ? null : result);
	}

	private newTx(writable: boolean) {
		return new Tx(this.store.tables, this.env, null, writable);
	}

	/** Run a query handler against `tx` (a fresh snapshot or an enclosing mutation's tx). */
	private async execQuery(entry: FnEntry, args: unknown, tx: Tx = this.newTx(false)) {
		const a = this.checkArgs(entry, args);
		const ctx = {
			...this.baseCtx(),
			db: makeDb(tx, { writable: false }),
			runQuery: (ref: RefLike, qargs?: unknown) =>
				this.execQuery(this.lookup(ref, 'query', false), qargs, tx)
		};
		return this.invoke(entry, ctx, a);
	}

	private makeScheduler(txFor: () => Tx | Promise<Tx>) {
		const schedule = async (when: number, ref: RefLike, args: unknown) => {
			const entry = this.lookup(ref, null, false);
			if (entry.kind === 'query') throw new Error(`Cannot schedule query ${entry.name}; schedule a mutation or action.`);
			const tx = await txFor();
			const id = this.env.newId(SCHEDULED_TABLE);
			const doc: Doc = {
				_id: id,
				_creationTime: this.env.newCreationTime(),
				name: entry.name,
				args: [cloneValue(args === undefined ? {} : args)],
				scheduledTime: when,
				state: { kind: 'pending' }
			};
			tx.insertDoc(SCHEDULED_TABLE, doc);
			tx.scheduledInserted.push(id);
			return id;
		};
		return {
			runAfter: (ms: number, ref: RefLike, args?: unknown) => schedule(Date.now() + Math.max(0, Number(ms) || 0), ref, args),
			runAt: (ts: number | Date, ref: RefLike, args?: unknown) =>
				schedule(ts instanceof Date ? ts.getTime() : Number(ts), ref, args),
			cancel: async (id: string) => {
				const tx = await txFor();
				const d = tx.lookup(SCHEDULED_TABLE, id);
				if (!d) throw new Error(`Scheduled function with ID "${id}" not found`);
				const state = (d.state as { kind: string }).kind;
				if (state !== 'pending') {
					throw new Error(`Scheduled function with ID "${id}" can't be canceled: it is ${state}.`);
				}
				tx.upsertDoc(SCHEDULED_TABLE, { ...d, state: { kind: 'canceled' }, completedTime: Date.now() });
			}
		};
	}

	/** Run a mutation handler inside `tx` (top-level or nested child). */
	private async runMutationBody(entry: FnEntry, args: unknown, tx: Tx) {
		const a = this.checkArgs(entry, args);
		const ctx = {
			...this.baseCtx(),
			db: makeDb(tx, { writable: true }),
			scheduler: this.makeScheduler(() => tx),
			runQuery: (ref: RefLike, qargs?: unknown) =>
				this.execQuery(this.lookup(ref, 'query', false), qargs, tx),
			runMutation: async (ref: RefLike, margs?: unknown) => {
				const child = tx.child(true);
				const sub = this.lookup(ref, 'mutation', false);
				const res = await this.runMutationBody(sub, margs, child);
				child.mergeIntoParent();
				return res;
			}
		};
		return this.invoke(entry, ctx, a);
	}

	/** Serialize `fn` after all previously queued mutations. */
	private exclusive<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.queue.then(fn, fn);
		this.queue = run.catch(() => {});
		return run;
	}

	/**
	 * Run a top-level transaction. `body` receives the tx; nothing is committed if it throws.
	 */
	private transact<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
		return this.exclusive(async () => {
			const tx = this.newTx(true);
			const result = await body(tx);
			this.commit(tx);
			return result;
		});
	}

	private execMutation(entry: FnEntry, args: unknown, finalize?: (tx: Tx) => void) {
		return this.transact(async (tx) => {
			const r = await this.runMutationBody(entry, args, tx);
			finalize?.(tx);
			return r;
		});
	}

	private commit(tx: Tx) {
		const ws = tx.toWriteSet();
		const touched = Object.keys(ws);
		if (!touched.length) return;
		this.store.applyWrites(ws);
		this.store.seq++;
		this.schedulePersist();
		this.channel?.postMessage({ t: 'commit', from: this.tabId, seq: this.store.seq, ws });
		this.markDirty(touched);
		if (ws[SCHEDULED_TABLE]) this.rearm();
	}

	private async execAction(entry: FnEntry, args: unknown) {
		const a = this.checkArgs(entry, args);
		const ctx = {
			...this.baseCtx(),
			scheduler: this.makeSchedulerForAction(),
			runQuery: (ref: RefLike, qargs?: unknown) => this.execQuery(this.lookup(ref, 'query', false), qargs),
			runMutation: (ref: RefLike, margs?: unknown) => this.execMutation(this.lookup(ref, 'mutation', false), margs),
			runAction: (ref: RefLike, aargs?: unknown) => this.execAction(this.lookup(ref, 'action', false), aargs),
			vectorSearch: async () => {
				throw new Error('Vector search is not available in the local runtime.');
			}
		};
		return this.invoke(entry, ctx, a);
	}

	/** Scheduler for actions: each call commits in its own small transaction. */
	private makeSchedulerForAction() {
		const inTx = <T>(f: (s: ReturnType<LocalRuntime['makeScheduler']>) => Promise<T>) =>
			this.transact(async (tx) => f(this.makeScheduler(() => tx)));
		return {
			runAfter: (ms: number, ref: RefLike, args?: unknown) => inTx((s) => s.runAfter(ms, ref, args)),
			runAt: (ts: number | Date, ref: RefLike, args?: unknown) => inTx((s) => s.runAt(ts, ref, args)),
			cancel: (id: string) => inTx((s) => s.cancel(id))
		};
	}

	/* ------------------------------ public API ------------------------------ */

	async query(ref: RefLike, args?: unknown): Promise<unknown> {
		await this.ready;
		const entry = this.lookup(ref, 'query', true);
		return this.execQuery(entry, args);
	}

	async mutation(ref: RefLike, args?: unknown): Promise<unknown> {
		await this.ready;
		return this.mutationNow(ref, args);
	}

	private mutationNow(ref: RefLike, args?: unknown): Promise<unknown> {
		const entry = this.lookup(ref, 'mutation', true);
		if (this.role === 'leader') return this.execMutation(entry, args);
		return this.rpc('mutation', entry.name, this.checkArgs(entry, args));
	}

	async action(ref: RefLike, args?: unknown): Promise<unknown> {
		await this.ready;
		const entry = this.lookup(ref, 'action', true);
		if (this.role === 'leader') return this.execAction(entry, args);
		return this.rpc('action', entry.name, this.checkArgs(entry, args));
	}

	/** Does a public function exist? (used to decide whether to call `seed.ensure`) */
	hasFunction(ref: RefLike): boolean {
		try {
			return this.functions.has(toFunctionName(ref));
		} catch {
			return false;
		}
	}

	/** Wipe the database (all tabs). */
	async reset(): Promise<void> {
		await this.ready;
		if (this.role !== 'leader') {
			await this.rpc('reset', '', {});
			return;
		}
		await this.exclusive(async () => this.doReset());
	}

	private doReset() {
		this.store.clear();
		this.store.seq++;
		try {
			this.o.storage?.removeItem(this.storageKey);
		} catch {
			/* ignore */
		}
		this.schedulePersist();
		this.channel?.postMessage({ t: 'reset', from: this.tabId, seq: this.store.seq });
		this.markDirty(['*']);
		this.rearm();
	}

	/* ------------------------------ subscriptions ------------------------------ */

	onUpdate(
		ref: RefLike,
		args: unknown,
		cb: (value: unknown) => void,
		errCb?: (error: Error) => void
	): () => void {
		const a = (args === undefined ? {} : cloneValue(args)) as Record<string, unknown>;
		let sub: Sub | undefined;
		const name = toFunctionName(ref);
		const key = `${name}|${stableKey(a)}`;
		const listener: Listener = { cb, errCb };
		let cancelled = false;

		const attach = () => {
			if (cancelled) return;
			sub = this.subs.get(key);
			if (!sub) {
				let entry: FnEntry;
				try {
					entry = this.lookup(ref, 'query', true);
				} catch (e) {
					errCb?.(e as Error);
					return;
				}
				sub = { key, entry, args: a, listeners: new Set(), readTables: new Set(), running: false, dirty: false };
				this.subs.set(key, sub);
				sub.listeners.add(listener);
				void this.refresh(sub);
				return;
			}
			sub.listeners.add(listener);
			if (sub.result) this.emitTo(listener, sub.result);
		};

		// Wait for boot without delaying the common (already-ready) case by a macrotask.
		void this.ready.then(attach, (e) => errCb?.(e as Error));

		return () => {
			cancelled = true;
			if (!sub) return;
			sub.listeners.delete(listener);
			if (sub.listeners.size === 0) this.subs.delete(sub.key);
		};
	}

	/** Synchronous cached result of an active subscription, like ConvexClient.localQueryResult. */
	localQueryResult(ref: RefLike, args?: unknown): unknown {
		const a = (args === undefined ? {} : args) as Record<string, unknown>;
		const sub = this.subs.get(`${toFunctionName(ref)}|${stableKey(a)}`);
		if (!sub?.result) return undefined;
		if (sub.result.ok) return (sub.result.cloned ??= cloneValue(sub.result.value));
		throw sub.result.error;
	}

	private emitTo(l: Listener, r: SubResult) {
		try {
			if (r.ok) l.cb(cloneValue(r.value));
			else l.errCb?.(r.error);
		} catch (e) {
			this.log('error', 'Subscription listener threw', e);
		}
	}

	private async refresh(sub: Sub) {
		if (sub.running) {
			sub.dirty = true;
			return;
		}
		sub.running = true;
		try {
			do {
				sub.dirty = false;
				const tx = this.newTx(false);
				let next: SubResult;
				try {
					next = { ok: true, value: await this.execQuery(sub.entry, sub.args, tx) };
				} catch (e) {
					next = { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
				}
				sub.readTables = tx.readTables;
				const prev = sub.result;
				const changed =
					!prev ||
					prev.ok !== next.ok ||
					(prev.ok && next.ok ? !valuesEqual(prev.value, next.value) : !prev.ok && !next.ok && prev.error.message !== next.error.message);
				if (changed) {
					sub.result = next;
					for (const l of [...sub.listeners]) this.emitTo(l, next);
				}
			} while (sub.dirty && this.subs.has(sub.key));
		} finally {
			sub.running = false;
		}
	}

	private markDirty(tables: string[]) {
		for (const t of tables) this.dirtyTables.add(t);
		if (this.notifyScheduled) return;
		this.notifyScheduled = true;
		queueMicrotask(() => {
			this.notifyScheduled = false;
			const dirty = this.dirtyTables;
			this.dirtyTables = new Set();
			const all = dirty.has('*');
			for (const sub of this.subs.values()) {
				if (sub.running) {
					sub.dirty = true;
					continue;
				}
				if (all || !sub.result) {
					void this.refresh(sub);
					continue;
				}
				for (const t of sub.readTables) {
					if (dirty.has(t)) {
						void this.refresh(sub);
						break;
					}
				}
			}
		});
	}

	/* ------------------------------ scheduler ------------------------------ */

	/** Compute the next wake-up time and (re)arm the single timer. */
	private rearm() {
		if (this.role !== 'leader' || this.disposed || this.o.runScheduled === false) return;
		let next = Infinity;
		const jobs = this.store.tables.get(SCHEDULED_TABLE);
		if (jobs) {
			for (const d of jobs.values()) {
				if ((d.state as { kind: string }).kind === 'pending' && !this.inflight.has(d._id)) {
					next = Math.min(next, d.scheduledTime as number);
				}
			}
		}
		for (const [id, spec] of Object.entries(this.cronSpecs)) {
			if (this.inflight.has(`cron:${id}`)) continue;
			const last = this.store.cronLastRun[id];
			if (last === undefined) continue;
			next = Math.min(next, nextRun(spec.schedule, last));
		}
		if (this.wakeTimer && next >= this.wakeAt && this.wakeAt > Date.now()) return;
		if (this.wakeTimer) clearTimeout(this.wakeTimer);
		this.wakeTimer = null;
		this.wakeAt = next;
		if (next === Infinity) return;
		const delay = Math.min(Math.max(0, next - Date.now()), MAX_TIMEOUT);
		this.wakeTimer = setTimeout(() => {
			this.wakeTimer = null;
			this.wakeAt = Infinity;
			this.tick();
		}, delay);
	}

	/** Run everything that is due (scheduled functions and crons). */
	tick() {
		if (this.role !== 'leader' || this.disposed || this.o.runScheduled === false) return;
		const now = Date.now();
		const jobs = this.store.tables.get(SCHEDULED_TABLE);
		if (jobs) {
			const due = [...jobs.values()]
				.filter(
					(d) =>
						(d.state as { kind: string }).kind === 'pending' &&
						(d.scheduledTime as number) <= now &&
						!this.inflight.has(d._id)
				)
				.sort((a, b) => (a.scheduledTime as number) - (b.scheduledTime as number) || a._creationTime - b._creationTime);
			for (const job of due) {
				this.inflight.add(job._id);
				void this.runScheduledJob(job).finally(() => {
					this.inflight.delete(job._id);
					this.rearm();
				});
			}
		}
		this.tickCrons(now);
		if (now - this.lastPrune > 10 * 60_000) void this.pruneJobs();
		this.rearm();
	}

	private tickCrons(now: number) {
		for (const [id, spec] of Object.entries(this.cronSpecs)) {
			const last = this.store.cronLastRun[id];
			if (last === undefined) {
				this.setCronLastRun(id, now);
				continue;
			}
			if (this.inflight.has(`cron:${id}`)) continue;
			if (nextRun(spec.schedule, last) <= now) {
				this.setCronLastRun(id, now);
				this.inflight.add(`cron:${id}`);
				void this.runCron(id, spec).finally(() => {
					this.inflight.delete(`cron:${id}`);
					this.rearm();
				});
			}
		}
	}

	private setCronLastRun(id: string, ts: number) {
		this.store.cronLastRun[id] = ts;
		this.channel?.postMessage({ t: 'cron', from: this.tabId, id, ts });
		this.schedulePersist();
	}

	private async runCron(id: string, spec: CronSpec) {
		try {
			const entry = this.functions.get(toFunctionName(spec.name));
			if (!entry) throw new Error(`Cron "${id}" refers to unknown function ${spec.name}`);
			const args = spec.args?.[0] !== undefined ? jsonToConvex(spec.args[0] as never) : {};
			if (entry.kind === 'mutation') await this.execMutation(entry, args);
			else if (entry.kind === 'action') await this.execAction(entry, args);
			else throw new Error(`Cron "${id}" must run a mutation or action`);
		} catch (e) {
			this.log('error', `Cron "${id}" failed:`, e);
		}
	}

	private async markJob(id: string, state: Record<string, unknown>) {
		await this.transact(async (tx) => {
			const d = tx.lookup(SCHEDULED_TABLE, id);
			if (!d) return;
			const next: Doc = { ...d, state };
			if (state.kind === 'inProgress') delete next.completedTime;
			else next.completedTime = Date.now();
			tx.upsertDoc(SCHEDULED_TABLE, next);
		});
	}

	private async runScheduledJob(job: Doc) {
		const entry = this.functions.get(job.name as string);
		const args = (job.args as unknown[])[0] ?? {};
		const finish = (state: Record<string, unknown>) => (tx: Tx) => {
			const d = tx.lookup(SCHEDULED_TABLE, job._id);
			if (d) {
				const next: Doc = { ...d, state, completedTime: Date.now() };
				tx.upsertDoc(SCHEDULED_TABLE, next);
			}
		};
		try {
			if (!entry) throw new Error(`Scheduled function "${job.name}" not found`);
			if (entry.kind === 'mutation') {
				try {
					await this.execMutation(entry, args, finish({ kind: 'success' }));
				} catch (e) {
					this.log('error', `Scheduled mutation ${job.name} failed:`, e);
					await this.markJob(job._id, { kind: 'failed', error: (e as Error).message });
				}
			} else if (entry.kind === 'action') {
				await this.markJob(job._id, { kind: 'inProgress' });
				try {
					await this.execAction(entry, args);
					await this.markJob(job._id, { kind: 'success' });
				} catch (e) {
					this.log('error', `Scheduled action ${job.name} failed:`, e);
					await this.markJob(job._id, { kind: 'failed', error: (e as Error).message });
				}
			} else {
				throw new Error(`Cannot run scheduled query ${job.name}`);
			}
		} catch (e) {
			this.log('error', e);
			try {
				await this.markJob(job._id, { kind: 'failed', error: (e as Error).message });
			} catch {
				/* ignore */
			}
		}
	}

	/** Delete finished scheduled-function records older than an hour. */
	private async pruneJobs() {
		this.lastPrune = Date.now();
		const jobs = this.store.tables.get(SCHEDULED_TABLE);
		if (!jobs) return;
		const cutoff = Date.now() - 60 * 60_000;
		const old = [...jobs.values()].filter(
			(d) => (d.state as { kind: string }).kind !== 'pending' && (d.state as { kind: string }).kind !== 'inProgress' && ((d.completedTime as number) ?? 0) < cutoff
		);
		if (!old.length) return;
		await this.transact(async (tx) => {
			for (const d of old) tx.removeDoc(SCHEDULED_TABLE, d._id);
		});
	}

	/* ------------------------------ cross-tab ------------------------------ */

	private onMessage(msg: Record<string, unknown>) {
		if (!msg || msg.from === this.tabId || this.disposed) return;
		switch (msg.t) {
			case 'hello':
				if (this.role === 'leader') {
					if (msg.seq !== this.store.seq) {
						this.channel?.postMessage({ t: 'snapshot', to: msg.from, from: this.tabId, snap: JSON.stringify(this.store.toSnapshot()) });
					}
					this.channel?.postMessage({ t: 'leader', to: msg.from, from: this.tabId });
				}
				break;
			case 'snapshot':
				if (msg.to === this.tabId && this.role !== 'leader') this.adoptSnapshot(msg.snap as string);
				break;
			case 'commit': {
				if (this.role === 'leader') break;
				const seq = msg.seq as number;
				if (seq <= this.store.seq) break;
				if (seq !== this.store.seq + 1) {
					// Missed something: ask the leader for a full snapshot.
					this.channel?.postMessage({ t: 'hello', from: this.tabId, seq: -1 });
					break;
				}
				const touched = this.store.applyWrites(msg.ws as WriteSet);
				this.store.seq = seq;
				this.markDirty(touched);
				break;
			}
			case 'cron':
				if (this.role !== 'leader') this.store.cronLastRun[msg.id as string] = msg.ts as number;
				break;
			case 'reset':
				if (this.role !== 'leader') {
					this.store.clear();
					this.store.seq = msg.seq as number;
					this.markDirty(['*']);
				}
				break;
			case 'leader':
				if (this.role === 'leader') break;
				if (msg.to === undefined) {
					// Broadcast: a (new) leader started. Make sure our replica is current.
					this.channel?.postMessage({ t: 'hello', from: this.tabId, seq: this.store.seq });
				} else if (msg.to !== this.tabId) {
					break;
				}
				// A leader exists: resend whatever is still waiting for an answer.
				for (const p of this.pendingRpc.values()) this.channel?.postMessage(p.msg);
				break;
			case 'rpc':
				if (this.role === 'leader') void this.handleRpc(msg as unknown as RpcMessage);
				break;
			case 'rpc-res': {
				if (msg.to !== this.tabId) break;
				const p = this.pendingRpc.get(msg.id as string);
				if (!p) break;
				this.pendingRpc.delete(msg.id as string);
				if (msg.ok) p.resolve(msg.value);
				else p.reject(deserializeError(msg.error as SerializedError));
				break;
			}
		}
	}

	private adoptSnapshot(raw: string) {
		try {
			const snap = JSON.parse(raw) as StoreSnapshot;
			this.store.loadSnapshot(snap);
			this.markDirty(['*']);
		} catch (e) {
			this.log('warn', 'Bad snapshot from leader', e);
		}
	}

	private rpc(kind: RpcMessage['kind'], name: string, args: unknown): Promise<unknown> {
		const id = `${this.tabId}:${Math.random().toString(36).slice(2)}`;
		const msg: RpcMessage = { t: 'rpc', from: this.tabId, id, kind, name, args };
		return new Promise((resolve, reject) => {
			this.pendingRpc.set(id, { msg, resolve, reject });
			this.channel?.postMessage(msg);
		});
	}

	private execRpc(msg: RpcMessage): Promise<{ ok: boolean; value?: unknown; error?: SerializedError }> {
		let cached = this.handledRpc.get(msg.id);
		if (cached) return cached;
		cached = (async () => {
			try {
				let value: unknown;
				if (msg.kind === 'reset') {
					await this.exclusive(async () => this.doReset());
					value = null;
				} else if (msg.kind === 'mutation') {
					value = await this.execMutation(this.lookup(msg.name, 'mutation', true), msg.args);
				} else if (msg.kind === 'action') {
					value = await this.execAction(this.lookup(msg.name, 'action', true), msg.args);
				} else {
					value = await this.execQuery(this.lookup(msg.name, 'query', true), msg.args);
				}
				return { ok: true, value };
			} catch (e) {
				return { ok: false, error: serializeError(e) };
			}
		})();
		this.handledRpc.set(msg.id, cached);
		setTimeout(() => this.handledRpc.delete(msg.id), 60_000);
		return cached;
	}

	private async handleRpc(msg: RpcMessage) {
		const res = await this.execRpc(msg);
		this.channel?.postMessage({ t: 'rpc-res', to: msg.from, from: this.tabId, id: msg.id, ...res });
	}

	/* ------------------------------ lifecycle ------------------------------ */

	/** Stop timers, release leadership, close the channel. Safe to call multiple times. */
	dispose() {
		if (this.disposed) return;
		this.flush();
		this.disposed = true;
		if (this.wakeTimer) clearTimeout(this.wakeTimer);
		if (this.persistTimer) clearTimeout(this.persistTimer);
		this.election?.stop();
		this.channel?.close();
		const g = globalThis as { removeEventListener?: (t: string, cb: () => void) => void };
		if (this.unloadHandler) g.removeEventListener?.('pagehide', this.unloadHandler);
		for (const p of this.pendingRpc.values()) p.reject(new Error('Local backend disposed'));
		this.pendingRpc.clear();
		this.subs.clear();
	}
}
