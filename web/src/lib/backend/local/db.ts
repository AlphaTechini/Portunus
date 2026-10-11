/**
 * `ctx.db` and the query builder for the in-browser Convex runtime.
 */
import { cloneValue, compareValues, getField, valuesEqual } from './values.js';
import { tableOfId } from './ids.js';
import type { Doc, IndexDef, TableMap, Tx } from './store.js';

/* ------------------------------ filter builder ----------------------------- */

class Expr {
	constructor(readonly ev: (doc: Doc) => unknown) {}
}

function toExpr(x: unknown): Expr {
	return x instanceof Expr ? x : new Expr(() => x);
}

function num(v: unknown, op: string): number {
	if (typeof v !== 'number') throw new Error(`filter ${op}: expected a number, got ${typeof v}`);
	return v;
}

function makeFilterBuilder() {
	const bin = (f: (a: unknown, b: unknown) => unknown) => (l: unknown, r: unknown) => {
		const a = toExpr(l);
		const b = toExpr(r);
		return new Expr((d) => f(a.ev(d), b.ev(d)));
	};
	return {
		eq: bin((a, b) => valuesEqual(a, b)),
		neq: bin((a, b) => !valuesEqual(a, b)),
		lt: bin((a, b) => compareValues(a, b) < 0),
		lte: bin((a, b) => compareValues(a, b) <= 0),
		gt: bin((a, b) => compareValues(a, b) > 0),
		gte: bin((a, b) => compareValues(a, b) >= 0),
		add: bin((a, b) => num(a, 'add') + num(b, 'add')),
		sub: bin((a, b) => num(a, 'sub') - num(b, 'sub')),
		mul: bin((a, b) => num(a, 'mul') * num(b, 'mul')),
		div: bin((a, b) => num(a, 'div') / num(b, 'div')),
		mod: bin((a, b) => num(a, 'mod') % num(b, 'mod')),
		neg: (x: unknown) => {
			const e = toExpr(x);
			return new Expr((d) => -num(e.ev(d), 'neg'));
		},
		and: (...xs: unknown[]) => {
			const es = xs.map(toExpr);
			return new Expr((d) => es.every((e) => e.ev(d) === true));
		},
		or: (...xs: unknown[]) => {
			const es = xs.map(toExpr);
			return new Expr((d) => es.some((e) => e.ev(d) === true));
		},
		not: (x: unknown) => {
			const e = toExpr(x);
			return new Expr((d) => e.ev(d) !== true);
		},
		field: (path: string) => new Expr((d) => getField(d, path))
	};
}

/* ----------------------------- index range builder ---------------------------- */

type RangeStep = { type: 'Eq' | 'Gt' | 'Gte' | 'Lt' | 'Lte'; field: string; value: unknown };

function makeRangeBuilder(steps: RangeStep[] = []) {
	let consumed = false;
	const add = (type: RangeStep['type']) => (field: string, value: unknown) => {
		if (consumed)
			throw new Error(
				'IndexRangeBuilder has already been used! Chain your method calls like `q => q.eq(...).eq(...)`.'
			);
		consumed = true;
		return makeRangeBuilder([...steps, { type, field, value }]);
	};
	return {
		steps,
		eq: add('Eq'),
		gt: add('Gt'),
		gte: add('Gte'),
		lt: add('Lt'),
		lte: add('Lte')
	};
}

/* --------------------------------- queries --------------------------------- */

interface QueryState {
	table: string;
	index: IndexDef | null;
	steps: RangeStep[];
	order: 'asc' | 'desc';
	filters: Expr[];
	limit?: number;
}

/** Sorted-index cache per immutable committed table snapshot. */
const sortedCache = new WeakMap<TableMap, Map<string, Doc[]>>();

const IMPLICIT_INDEXES: IndexDef[] = [
	{ name: 'by_creation_time', fields: ['_creationTime'] },
	{ name: 'by_id', fields: ['_id'] }
];

class QueryImpl {
	constructor(
		private readonly tx: Tx,
		private readonly s: QueryState
	) {}

	private with(patch: Partial<QueryState>) {
		return new QueryImpl(this.tx, { ...this.s, ...patch });
	}

	withIndex(indexName: string, rangeFn?: (q: unknown) => unknown) {
		const def =
			IMPLICIT_INDEXES.find((i) => i.name === indexName) ??
			this.tx.env.indexesFor(this.s.table).find((i) => i.name === indexName);
		if (!def) {
			throw new Error(`Index ${this.s.table}.${indexName} not found. Add it to the schema.`);
		}
		let steps: RangeStep[] = [];
		if (rangeFn) {
			const res = rangeFn(makeRangeBuilder()) as { steps: RangeStep[] } | undefined;
			steps = res?.steps ?? [];
		}
		validateRange(this.s.table, def, steps);
		return this.with({ index: def, steps });
	}

	withSearchIndex(): never {
		throw new Error('Search indexes are not supported by the local runtime.');
	}

	fullTableScan() {
		return this.with({ index: null, steps: [] });
	}

	order(order: 'asc' | 'desc') {
		if (order !== 'asc' && order !== 'desc') throw new Error(`Invalid order: ${String(order)}`);
		return this.with({ order });
	}

	filter(predicate: (q: unknown) => unknown) {
		const e = toExpr(predicate(makeFilterBuilder()));
		return this.with({ filters: [...this.s.filters, e] });
	}

	limit(n: number) {
		return this.with({ limit: n });
	}

	/** Docs of the table sorted by the chosen index (shared array when the snapshot is pristine). */
	private sortedDocs(idx: IndexDef): Doc[] {
		const { table } = this.s;
		const fields = idx.fields;
		const sort = (docs: Doc[]) => {
			const keyed = docs.map((d) => ({ d, k: fields.map((f) => getField(d, f)) }));
			keyed.sort((x, y) => {
				for (let i = 0; i < fields.length; i++) {
					const c = compareValues(x.k[i], y.k[i]);
					if (c !== 0) return c;
				}
				const c = compareValues(x.d._creationTime, y.d._creationTime);
				return c !== 0 ? c : compareValues(x.d._id, y.d._id);
			});
			return keyed.map((x) => x.d);
		};
		const pristine = this.tx.pristine(table);
		if (!pristine) return sort(this.tx.scan(table));
		let perTable = sortedCache.get(pristine);
		if (!perTable) sortedCache.set(pristine, (perTable = new Map()));
		const key = fields.join('\u0000');
		let sorted = perTable.get(key);
		if (!sorted) perTable.set(key, (sorted = sort(Array.from(pristine.values()))));
		return sorted;
	}

	/** Materialise matching documents (stored objects, not cloned). */
	private run(max?: number): Doc[] {
		const { index, steps, order, filters } = this.s;
		const idx = index ?? IMPLICIT_INDEXES[0];
		let out = this.sortedDocs(idx);
		if (steps.length) out = out.filter((d) => matchesRange(d, steps));
		if (order === 'desc') out = out.slice().reverse();
		if (filters.length) out = out.filter((d) => filters.every((f) => f.ev(d) === true));
		const lim = Math.min(max ?? Infinity, this.s.limit ?? Infinity);
		if (lim < out.length) out = out.slice(0, lim);
		return out;
	}

	async collect() {
		return this.run().map((d) => cloneValue(d));
	}
	async take(n: number) {
		if (!Number.isInteger(n) || n < 0) throw new Error('`take` expects a non-negative integer');
		return this.run(n).map((d) => cloneValue(d));
	}
	async first() {
		const r = this.run(1)[0];
		return r ? cloneValue(r) : null;
	}
	async unique() {
		const r = this.run(2);
		if (r.length > 1) {
			throw new Error(`unique() query returned more than one result from table ${this.s.table}`);
		}
		return r[0] ? cloneValue(r[0]) : null;
	}
	async count() {
		return this.run().length;
	}
	async paginate(opts: { numItems: number; cursor: string | null }) {
		const all = this.run();
		const start = opts.cursor ? parseInt(opts.cursor, 10) || 0 : 0;
		const page = all.slice(start, start + opts.numItems).map((d) => cloneValue(d));
		const end = start + opts.numItems;
		return { page, isDone: end >= all.length, continueCursor: String(Math.min(end, all.length)) };
	}
	[Symbol.asyncIterator]() {
		const items = this.run();
		let i = 0;
		return {
			next: async (): Promise<IteratorResult<Doc>> =>
				i < items.length
					? { value: cloneValue(items[i++]), done: false }
					: { value: undefined, done: true },
			return: async (): Promise<IteratorResult<Doc>> => ({ value: undefined, done: true })
		};
	}
}

function validateRange(table: string, idx: IndexDef, steps: RangeStep[]) {
	let i = 0;
	while (i < steps.length && steps[i].type === 'Eq') {
		if (idx.fields[i] !== steps[i].field) {
			throw new Error(
				`Index ${table}.${idx.name} range expression ${i + 1} must be on field "${idx.fields[i] ?? '(none)'}", got "${steps[i].field}". ` +
					`Equality comparisons must follow the index field order: ${idx.fields.join(', ')}.`
			);
		}
		i++;
	}
	const rest = steps.slice(i);
	if (rest.length > 2) throw new Error(`Index ${table}.${idx.name}: too many range expressions.`);
	for (const r of rest) {
		if (r.type === 'Eq')
			throw new Error(`Index ${table}.${idx.name}: equality must precede range comparisons.`);
		if (r.field !== idx.fields[i]) {
			throw new Error(
				`Index ${table}.${idx.name}: range comparison must be on field "${idx.fields[i] ?? '(none)'}", got "${r.field}".`
			);
		}
	}
	if (rest.length === 2) {
		const lower = (t: string) => t === 'Gt' || t === 'Gte';
		if (lower(rest[0].type) === lower(rest[1].type)) {
			throw new Error(`Index ${table}.${idx.name}: need one lower and one upper bound.`);
		}
	}
}

function matchesRange(doc: Doc, steps: RangeStep[]): boolean {
	for (const s of steps) {
		const c = compareValues(getField(doc, s.field), s.value);
		switch (s.type) {
			case 'Eq':
				if (c !== 0) return false;
				break;
			case 'Gt':
				if (!(c > 0)) return false;
				break;
			case 'Gte':
				if (!(c >= 0)) return false;
				break;
			case 'Lt':
				if (!(c < 0)) return false;
				break;
			case 'Lte':
				if (!(c <= 0)) return false;
				break;
		}
	}
	return true;
}

/* ------------------------------------ db ----------------------------------- */

const SYSTEM_FIELDS = new Set(['_id', '_creationTime']);

function userFields(doc: Doc): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of Object.keys(doc)) if (!SYSTEM_FIELDS.has(k)) out[k] = doc[k];
	return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LocalDb = Record<string, any>;

export function makeDb(
	tx: Tx,
	opts: { writable: boolean; system?: boolean } = { writable: true }
): LocalDb {
	const env = tx.env;
	const isSystem = !!opts.system;

	function resolveTable(method: string, id: unknown, table?: string): string {
		if (typeof id !== 'string') {
			throw new Error(
				`Invalid argument \`id\` for \`db.${method}\`, expected string but got '${typeof id}': ${String(id)}`
			);
		}
		const t = tableOfId(env.registry, id);
		if (!t)
			throw new Error(`Invalid argument \`id\` for \`db.${method}\`: Unable to decode ID: ${id}`);
		if (table !== undefined && table !== t) {
			throw new Error(
				`Invalid argument \`id\` for \`db.${method}\`: ID is from table "${t}", expected "${table}".`
			);
		}
		return t;
	}

	function checkWritable(table: string) {
		if (!opts.writable)
			throw new Error('Cannot write in a read-only context (queries cannot modify data).');
		if (table.startsWith('_')) throw new Error('System tables (prefixed with `_`) are read-only.');
	}

	function validate(table: string, doc: Doc) {
		env.validateDoc?.(table, userFields(doc));
	}

	const reader = {
		async get(a: string, b?: string) {
			const [table, id] =
				b !== undefined ? [resolveTable('get', b, a), b] : [resolveTable('get', a), a];
			const d = tx.lookup(table, id);
			return d ? cloneValue(d) : null;
		},
		query(table: string) {
			if (table.startsWith('_') !== isSystem) {
				throw new Error(
					`${table.startsWith('_') ? 'System' : 'User'} tables can only be accessed from db.${isSystem ? '' : 'system.'}query().`
				);
			}
			return new QueryImpl(tx, { table, index: null, steps: [], order: 'asc', filters: [] });
		},
		normalizeId(table: string, id: string): string | null {
			return typeof id === 'string' && tableOfId(env.registry, id) === table ? id : null;
		}
	};
	if (!opts.writable && !isSystem) {
		return Object.assign(reader, {
			system: makeDb(tx, { writable: false, system: true }),
			table: (name: string) => ({
				get: (id: string) => reader.get(name, id),
				query: () => reader.query(name)
			})
		});
	}

	async function insert(table: string, value: unknown) {
		checkWritable(table);
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			throw new Error(`Invalid argument \`value\` for \`db.insert\`: expected an object.`);
		}
		const fields = cloneValue(value as Record<string, unknown>) as Record<string, unknown>;
		for (const k of SYSTEM_FIELDS) {
			if (k in fields) throw new Error(`System field \`${k}\` cannot be written to \`db.insert\`.`);
		}
		const id = env.newId(table);
		const doc: Doc = { ...fields, _id: id, _creationTime: env.newCreationTime() };
		validate(table, doc);
		tx.insertDoc(table, doc);
		return id;
	}

	async function patch(table: string | undefined, id: string, value: Record<string, unknown>) {
		const t = resolveTable('patch', id, table);
		checkWritable(t);
		const cur = tx.lookup(t, id);
		if (!cur) throw new Error(`Patch on non-existent document with ID "${id}"`);
		const next: Doc = { ...cur };
		for (const [k, v] of Object.entries(value)) {
			if (SYSTEM_FIELDS.has(k)) continue;
			if (v === undefined) delete next[k];
			else next[k] = cloneValue(v, `.${k}`);
		}
		validate(t, next);
		tx.upsertDoc(t, next);
	}

	async function replace(table: string | undefined, id: string, value: Record<string, unknown>) {
		const t = resolveTable('replace', id, table);
		checkWritable(t);
		const cur = tx.lookup(t, id);
		if (!cur) throw new Error(`Replace on non-existent document with ID "${id}"`);
		const fields = cloneValue(value) as Record<string, unknown>;
		const next: Doc = { ...fields, _id: cur._id, _creationTime: cur._creationTime };
		validate(t, next);
		tx.upsertDoc(t, next);
	}

	async function del(table: string | undefined, id: string) {
		const t = resolveTable('delete', id, table);
		checkWritable(t);
		if (!tx.lookup(t, id)) throw new Error(`Delete on non-existent document with ID "${id}"`);
		tx.removeDoc(t, id);
	}

	return Object.assign(reader, {
		system: isSystem ? undefined : makeDb(tx, { writable: false, system: true }),
		table: (name: string) => ({
			get: (id: string) => reader.get(name, id),
			query: () => reader.query(name),
			insert: (value: unknown) => insert(name, value),
			patch: (id: string, value: Record<string, unknown>) => patch(name, id, value),
			replace: (id: string, value: Record<string, unknown>) => replace(name, id, value),
			delete: (id: string) => del(name, id)
		}),
		insert,
		patch: (a: string, b: string | Record<string, unknown>, c?: Record<string, unknown>) =>
			c !== undefined
				? patch(a, b as string, c)
				: patch(undefined, a, b as Record<string, unknown>),
		replace: (a: string, b: string | Record<string, unknown>, c?: Record<string, unknown>) =>
			c !== undefined
				? replace(a, b as string, c)
				: replace(undefined, a, b as Record<string, unknown>),
		delete: (a: string, b?: string) => (b !== undefined ? del(a, b) : del(undefined, a))
	});
}
