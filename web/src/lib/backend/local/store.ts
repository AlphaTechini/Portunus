/**
 * Storage layer of the in-browser Convex runtime.
 *
 *  - `Store` holds the committed state. `tables` is replaced (copy-on-write) on every
 *    commit, so a transaction that captured the map at its start keeps a stable snapshot.
 *  - `Tx` is a transaction: a layered write overlay on top of that snapshot. Nested
 *    mutations (`ctx.runMutation` inside a mutation) use a child overlay that is merged
 *    into the parent on success and discarded on failure.
 */
import { convexToJson, jsonToConvex } from 'convex/values';
import { TableRegistry, makeId, tableOfId } from './ids.js';

export type Doc = { _id: string; _creationTime: number; [key: string]: unknown };
export type TableMap = Map<string, Doc>;
export type TablesState = Map<string, TableMap>;

export interface IndexDef {
	name: string;
	fields: string[];
}

export interface WriteSet {
	[table: string]: { upserts: Doc[]; deletes: string[] };
}

export interface TxEnv {
	registry: TableRegistry;
	indexesFor(table: string): IndexDef[];
	newId(table: string): string;
	newCreationTime(): number;
	/** Throws if the document does not match the schema. `fields` excludes system fields. */
	validateDoc?(table: string, fields: Record<string, unknown>): void;
}

export const SCHEDULED_TABLE = '_scheduled_functions';

export interface StoreSnapshot {
	v: 1;
	seq: number;
	lastCreationTime: number;
	tableNums: Record<string, number>;
	cronLastRun: Record<string, number>;
	tables: Record<string, unknown[]>;
}

export class Store {
	tables: TablesState = new Map();
	seq = 0;
	lastCreationTime = 0;
	registry = new TableRegistry();
	cronLastRun: Record<string, number> = {};

	/** Make sure tables exist (empty) and have registry numbers. */
	ensureTables(names: string[]) {
		for (const n of names) this.registry.numberFor(n);
	}

	/** Apply a write set (local commit or a delta from another tab). Returns tables touched. */
	applyWrites(ws: WriteSet): string[] {
		const next: TablesState = new Map(this.tables);
		const touched: string[] = [];
		for (const [table, w] of Object.entries(ws)) {
			if (!w.upserts.length && !w.deletes.length) continue;
			this.registry.numberFor(table);
			const m: TableMap = new Map(next.get(table) ?? []);
			for (const id of w.deletes) m.delete(id);
			for (const doc of w.upserts) {
				m.set(doc._id, doc);
				if (doc._creationTime > this.lastCreationTime) this.lastCreationTime = doc._creationTime;
			}
			next.set(table, m);
			touched.push(table);
		}
		this.tables = next;
		return touched;
	}

	newCreationTime(): number {
		const t = Math.max(Date.now(), this.lastCreationTime + 0.001);
		this.lastCreationTime = Math.round(t * 1000) / 1000;
		return this.lastCreationTime;
	}

	toSnapshot(): StoreSnapshot {
		const tables: Record<string, unknown[]> = {};
		for (const [name, m] of this.tables) {
			tables[name] = Array.from(m.values(), (d) => convexToJson(d as never));
		}
		return {
			v: 1,
			seq: this.seq,
			lastCreationTime: this.lastCreationTime,
			tableNums: this.registry.nums,
			cronLastRun: this.cronLastRun,
			tables
		};
	}

	/** Replace all state from a snapshot. */
	loadSnapshot(snap: StoreSnapshot) {
		const tables: TablesState = new Map();
		for (const [name, docs] of Object.entries(snap.tables)) {
			const m: TableMap = new Map();
			for (const j of docs) {
				const d = jsonToConvex(j as never) as Doc;
				m.set(d._id, d);
			}
			tables.set(name, m);
		}
		this.tables = tables;
		this.seq = snap.seq ?? 0;
		this.lastCreationTime = snap.lastCreationTime ?? 0;
		this.registry.adopt(snap.tableNums ?? {});
		this.cronLastRun = { ...(snap.cronLastRun ?? {}) };
	}

	clear() {
		this.tables = new Map();
		this.cronLastRun = {};
		this.seq = 0;
	}
}

function chain(tx: Tx): Tx[] {
	const out: Tx[] = [];
	for (let t: Tx | null = tx; t; t = t.parent) out.push(t);
	return out.reverse(); // root first
}

export class Tx {
	/** table -> id -> doc (upsert) or null (delete) */
	overlay = new Map<string, Map<string, Doc | null>>();
	readTables = new Set<string>();
	/** Scheduled function ids inserted by this tx (so the runtime can arm timers after commit). */
	scheduledInserted: string[] = [];

	constructor(
		readonly base: TablesState,
		readonly env: TxEnv,
		readonly parent: Tx | null = null,
		readonly writable = true
	) {}

	child(writable = true): Tx {
		return new Tx(this.base, this.env, this, writable);
	}

	private lookupOverlay(table: string, id: string): Doc | null | undefined {
		for (let t: Tx | null = this; t; t = t.parent) {
			const o = t.overlay.get(table)?.get(id);
			if (o !== undefined) return o;
		}
		return undefined;
	}

	lookup(table: string, id: string): Doc | undefined {
		this.readTables.add(table);
		const o = this.lookupOverlay(table, id);
		if (o !== undefined) return o === null ? undefined : o;
		return this.base.get(table)?.get(id);
	}

	/** All visible docs of a table (stored objects, do not mutate). */
	scan(table: string): Doc[] {
		this.readTables.add(table);
		const baseMap = this.base.get(table);
		const layers = chain(this).filter((t) => t.overlay.has(table));
		if (!layers.length) return baseMap ? Array.from(baseMap.values()) : [];
		const merged = new Map<string, Doc>(baseMap ?? []);
		for (const l of layers) {
			for (const [id, d] of l.overlay.get(table)!) {
				if (d === null) merged.delete(id);
				else merged.set(id, d);
			}
		}
		return Array.from(merged.values());
	}

	private put(table: string, doc: Doc | null, id: string) {
		if (!this.writable) throw new Error('Cannot write in a read-only context (queries cannot modify data).');
		let m = this.overlay.get(table);
		if (!m) this.overlay.set(table, (m = new Map()));
		m.set(id, doc);
	}

	insertDoc(table: string, doc: Doc) {
		this.env.registry.numberFor(table);
		this.put(table, doc, doc._id);
	}
	upsertDoc(table: string, doc: Doc) {
		this.put(table, doc, doc._id);
	}
	removeDoc(table: string, id: string) {
		this.put(table, null, id);
	}

	/** Merge this (child) overlay into its parent. */
	mergeIntoParent() {
		const p = this.parent!;
		for (const [table, m] of this.overlay) {
			for (const [id, d] of m) p.put(table, d, id);
		}
		for (const t of this.readTables) p.readTables.add(t);
		p.scheduledInserted.push(...this.scheduledInserted);
	}

	/** Compute the write set relative to the base snapshot (root tx only). */
	toWriteSet(): WriteSet {
		const ws: WriteSet = {};
		for (const [table, m] of this.overlay) {
			const base = this.base.get(table);
			const w = { upserts: [] as Doc[], deletes: [] as string[] };
			for (const [id, d] of m) {
				if (d === null) {
					if (base?.has(id)) w.deletes.push(id);
				} else w.upserts.push(d);
			}
			if (w.upserts.length || w.deletes.length) ws[table] = w;
		}
		return ws;
	}
}

export { makeId, tableOfId };
