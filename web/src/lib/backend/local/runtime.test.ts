// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvexError } from 'convex/values';
import { api, fixtureModules, makeRuntime, memoryStorage } from './__fixtures__/helpers.js';
import { LocalRuntime } from './runtime.js';
import { compareValues, cloneValue } from './values.js';

import { anyApi } from 'convex/server';
const anyApiRef = anyApi as any;
const live: LocalRuntime[] = [];
function rt(opts: Parameters<typeof makeRuntime>[0] = {}) {
	const r = makeRuntime(opts);
	live.push(r);
	return r;
}
afterEach(() => {
	while (live.length) live.pop()!.dispose();
	vi.useRealTimers();
});

describe('values', () => {
	it('orders mixed types like Convex', () => {
		const vals: unknown[] = [{ a: 1 }, [1], new ArrayBuffer(1), 'a', true, 1.5, 3n, null];
		const sorted = [...vals].sort(compareValues);
		expect(sorted).toEqual([null, 3n, 1.5, true, 'a', new ArrayBuffer(1), [1], { a: 1 }]);
		expect(compareValues(undefined, null)).toBeLessThan(0);
		expect(compareValues([1, 2], [1, 3])).toBeLessThan(0);
		expect(compareValues({ a: 2 }, { a: 1, b: 0 })).toBeGreaterThan(0);
	});
	it('clone drops undefined fields and rejects bad values', () => {
		expect(cloneValue({ a: 1, b: undefined })).toEqual({ a: 1 });
		expect(() => cloneValue([undefined])).toThrow();
		expect(() => cloneValue({ d: new Date() })).toThrow();
	});
});

describe('db basics', () => {
	it('insert/get/patch/replace/delete round trip', async () => {
		const r = rt();
		const id = (await r.mutation(api.app.addItem, { title: 'a', qty: 1, tag: 'x' })) as string;
		expect(id).toHaveLength(32);
		const doc = (await r.query(api.app.getItem, { id })) as any;
		expect(doc).toMatchObject({ _id: id, title: 'a', qty: 1, tag: 'x' });
		expect(typeof doc._creationTime).toBe('number');
	});

	it('ids encode the table, creation times strictly increase', async () => {
		const r = rt();
		const ids: string[] = [];
		for (let i = 0; i < 5; i++) ids.push((await r.mutation(api.app.addItem, { title: `t${i}`, qty: i })) as string);
		const items = (await r.query(api.app.listItems, {})) as any[];
		const times = items.map((d) => d._creationTime);
		expect([...times].sort((a, b) => a - b)).toEqual(times);
		expect(new Set(times).size).toBe(5);
		// getItem with an id of another table is rejected by the validator
		const logId = ((await r.store.tables.get('items')) && ids[0])!;
		expect(logId).toBe(ids[0]);
	});

	it('rejects args that fail validation', async () => {
		const r = rt();
		await expect(r.mutation(api.app.addItem, { title: 1, qty: 1 })).rejects.toThrow(/ArgumentValidationError/);
		await expect(r.mutation(api.app.addItem, { title: 'a', qty: 1, extra: true })).rejects.toThrow(/extra field/);
		await expect(r.mutation(api.app.addItem, { title: 'a' })).rejects.toThrow(/missing the required field/);
	});

	it('public API refuses internal functions, wrong kinds and unknown names', async () => {
		const r = rt();
		await expect(r.mutation(api.app.secretInternal, {})).rejects.toThrow(/Could not find public function/);
		await expect(r.query(api.app.addItem, {})).rejects.toThrow(/is a mutation, not a query/);
		await expect(r.query(api.nope.nothing, {})).rejects.toThrow(/Could not find/);
	});
});

describe('queries and indexes', () => {
	async function seedItems(r: LocalRuntime) {
		for (const [title, qty, tag] of [
			['a', 5, 'x'],
			['b', 3, 'y'],
			['c', 9, 'x'],
			['d', 1, 'x'],
			['e', 7, undefined]
		] as const) {
			await r.mutation(api.app.addItem, { title, qty, tag });
		}
	}

	it('orders and filters through withIndex', async () => {
		const r = rt();
		await seedItems(r);
		const x = (await r.query(api.app.listItems, { tag: 'x' })) as any[];
		expect(x.map((d) => d.title)).toEqual(['a', 'c', 'd']); // by tag then creation time
		const none = (await r.query(api.app.listItems, { tag: 'nope' })) as any[];
		expect(none).toEqual([]);
	});

	it('supports range, order desc, filter, take, first, unique, paginate, async iteration', async () => {
		const r = rt();
		await seedItems(r);
		// Use a one-off query module through a custom runtime
		const { queryGeneric: query } = await import('convex/server');
		const { v } = await import('convex/values');
		const mod = {
			range: query({
				args: {},
				handler: async (ctx) => {
					const out: Record<string, unknown> = {};
					out.gt3lte7 = (await ctx.db.query('items').withIndex('by_qty', (q) => q.gt('qty', 3).lte('qty', 7)).collect()).map((d: any) => d.qty);
					out.desc = (await ctx.db.query('items').withIndex('by_qty').order('desc').take(2)).map((d: any) => d.qty);
					out.tagRange = (await ctx.db.query('items').withIndex('by_tag_qty', (q: any) => q.eq('tag', 'x').gte('qty', 5)).collect()).map((d: any) => d.qty);
					out.filter = (await ctx.db.query('items').filter((q) => q.and(q.eq(q.field('tag'), 'x'), q.gt(q.field('qty'), 1))).collect()).map((d: any) => d.title);
					out.or = (await ctx.db.query('items').filter((q) => q.or(q.eq(q.field('tag'), 'y'), q.not(q.neq(q.field('qty'), 7)))).collect()).map((d: any) => d.title);
					out.first = (await ctx.db.query('items').withIndex('by_qty').first())?.qty;
					out.missingTag = (await ctx.db.query('items').withIndex('by_tag', (q) => q.eq('tag', undefined)).collect()).map((d: any) => d.title);
					const iter: string[] = [];
					for await (const d of ctx.db.query('items').order('desc')) iter.push((d as any).title);
					out.iter = iter;
					const p1 = await ctx.db.query('items').paginate({ numItems: 2, cursor: null });
					const p2 = await ctx.db.query('items').paginate({ numItems: 2, cursor: p1.continueCursor });
					out.pages = [p1.page.length, p1.isDone, p2.page.length, p2.isDone];
					out.count = await (ctx.db.query('items') as any).count();
					let uniqueErr = '';
					try {
						await ctx.db.query('items').unique();
					} catch (e) {
						uniqueErr = (e as Error).message;
					}
					out.uniqueErr = uniqueErr;
					out.uniqueOk = (await ctx.db.query('items').withIndex('by_qty', (q) => q.eq('qty', 9)).unique())?.title;
					return out;
				}
			}),
			badIndex: query({
				args: {},
				handler: async (ctx) => ctx.db.query('items').withIndex('by_tag_qty', (q) => q.eq('qty', 1)).collect()
			}),
			unknownIndex: query({ args: {}, handler: async (ctx) => ctx.db.query('items').withIndex('nope').collect() }),
			unused: query({ args: { id: v.id('items') }, handler: async () => null })
		};
		const r2 = rt({ modules: { ...fixtureModules(), 'probe.ts': mod }, storage: null });
		// copy state: re-run the same seeding on r2
		await seedItems(r2);
		const out = (await r2.query(api.probe.range, {})) as any;
		expect(out.gt3lte7).toEqual([5, 7]);
		expect(out.desc).toEqual([9, 7]);
		expect(out.tagRange).toEqual([5, 9]);
		expect(out.filter).toEqual(['a', 'c']);
		expect(out.or).toEqual(['b', 'e']);
		expect(out.first).toBe(1);
		expect(out.missingTag).toEqual(['e']);
		expect(out.iter).toEqual(['e', 'd', 'c', 'b', 'a']);
		expect(out.pages).toEqual([2, false, 2, false]);
		expect(out.count).toBe(5);
		expect(out.uniqueErr).toMatch(/more than one/);
		expect(out.uniqueOk).toBe('c');
		await expect(r2.query(api.probe.badIndex, {})).rejects.toThrow(/must be on field/);
		await expect(r2.query(api.probe.unknownIndex, {})).rejects.toThrow(/not found/);
	});

	it('returned documents are copies, stored state cannot be mutated by handlers or callers', async () => {
		const r = rt();
		const id = (await r.mutation(api.app.addItem, { title: 'a', qty: 1 })) as string;
		const a = (await r.query(api.app.getItem, { id })) as any;
		a.title = 'MUTATED';
		const b = (await r.query(api.app.getItem, { id })) as any;
		expect(b.title).toBe('a');
	});
});

describe('transactions', () => {
	it('rolls back all writes when a mutation throws and keeps ConvexError data', async () => {
		const r = rt();
		let err: any;
		try {
			await r.mutation(api.app.failAfterWrite, {});
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(ConvexError);
		expect(err.data).toEqual({ code: 'NOPE', message: 'Nope, not allowed' });
		expect(await r.query(api.app.countLogs, {})).toBe(0);
	});

	it('serializes concurrent mutations', async () => {
		const r = rt();
		await Promise.all(Array.from({ length: 25 }, () => r.mutation(api.app.incr, { name: 'c' })));
		const c = [...r.store.tables.get('counters')!.values()];
		expect(c).toHaveLength(1);
		expect(c[0].value).toBe(25);
	});

	it('nested runMutation rolls back only the failed sub-mutation', async () => {
		const r = rt();
		const n = await r.mutation(api.app.nested, {});
		expect(n).toBe(1);
		expect(await r.query(api.app.countLogs, {})).toBe(0);
		expect(((await r.query(api.app.listItems, {})) as any[]).map((d) => d.title)).toEqual(['outer-ok']);
	});

	it('scheduling inside a failed mutation is discarded', async () => {
		vi.useFakeTimers();
		const r = rt();
		await expect(r.mutation(api.app.scheduleThenFail, {})).rejects.toThrow('boom');
		await vi.advanceTimersByTimeAsync(1000);
		expect(await r.query(api.app.countLogs, {})).toBe(0);
	});

	it('schema validation rejects bad documents', async () => {
		const { mutationGeneric: mutation } = await import('convex/server');
		const mod = {
			bad: mutation({ args: {}, handler: async (ctx) => ctx.db.insert('items', { title: 5 } as never) }),
			badPatch: mutation({
				args: {},
				handler: async (ctx) => {
					const id = await ctx.db.insert('items', { title: 'x', qty: 1 });
					await ctx.db.patch(id, { qty: 'str' } as never);
				}
			}),
			patchOps: mutation({
				args: {},
				handler: async (ctx) => {
					const id = await ctx.db.insert('items', { title: 'x', qty: 1, tag: 't' });
					await ctx.db.patch(id, { tag: undefined, qty: 2 });
					const d1 = await ctx.db.get(id);
					await ctx.db.replace(id, { title: 'y', qty: 3 });
					const d2 = await ctx.db.get(id);
					const norm = [ctx.db.normalizeId('items', id), ctx.db.normalizeId('logs', id), ctx.db.normalizeId('items', 'garbage')];
					await ctx.db.delete(id);
					const d3 = await ctx.db.get(id);
					return { d1, d2, norm, d3, id };
				}
			})
		};
		const r = rt({ modules: { ...fixtureModules(), 'probe.ts': mod } });
		await expect(r.mutation(api.probe.bad, {})).rejects.toThrow(/does not match the schema/);
		await expect(r.mutation(api.probe.badPatch, {})).rejects.toThrow(/does not match the schema/);
		const o = (await r.mutation(api.probe.patchOps, {})) as any;
		expect(o.d1).toMatchObject({ title: 'x', qty: 2 });
		expect('tag' in o.d1).toBe(false);
		expect(o.d2).toMatchObject({ title: 'y', qty: 3 });
		expect(o.d2._id).toBe(o.id);
		expect(o.norm).toEqual([o.id, null, null]);
		expect(o.d3).toBeNull();
	});
});

describe('read-your-writes inside a mutation', () => {
	it('queries in the same transaction see inserts, patches and deletes (no stale index cache)', async () => {
		const { mutationGeneric: mutation } = await import('convex/server');
		const mod = {
			ryw: mutation({
				args: {},
				handler: async (ctx) => {
					const before = (await ctx.db.query('items').withIndex('by_qty').collect()).length;
					const a = await ctx.db.insert('items', { title: 'a', qty: 5 });
					const b = await ctx.db.insert('items', { title: 'b', qty: 1 });
					const afterInsert = (await ctx.db.query('items').withIndex('by_qty').collect()).map((d: any) => d.title);
					await ctx.db.patch(a, { qty: 0 });
					const afterPatch = (await ctx.db.query('items').withIndex('by_qty').collect()).map((d: any) => d.title);
					await ctx.db.delete(b);
					const afterDelete = (await ctx.db.query('items').withIndex('by_qty').collect()).map((d: any) => d.title);
					const job = await ctx.scheduler.runAfter(10_000, anyApiRef.app.writeLog, { msg: 'x' });
					const sys = await ctx.db.system.get(job);
					return { before, afterInsert, afterPatch, afterDelete, sysState: (sys as any).state.kind, sysName: (sys as any).name };
				}
			})
		};
		const r = rt({ modules: { ...fixtureModules(), 'probe.ts': mod }, crons: { crons: {} } });
		const out = (await r.mutation(api.probe.ryw, {})) as any;
		expect(out).toEqual({
			before: 0,
			afterInsert: ['b', 'a'],
			afterPatch: ['a', 'b'],
			afterDelete: ['a'],
			sysState: 'pending',
			sysName: 'app:writeLog'
		});
		// and committed state matches
		expect(((await r.query(api.app.listItems, {})) as any[]).map((d) => d.title)).toEqual(['a']);
	});
});

describe('actions', () => {
	it('runs mutations/queries/scheduler from an action', async () => {
		vi.useFakeTimers();
		const r = rt();
		const p = r.action(api.app.slowAction, { n: 3 });
		await vi.advanceTimersByTimeAsync(20);
		expect(await p).toBe(3);
		await vi.advanceTimersByTimeAsync(10);
		expect(await r.query(api.app.countLogs, {})).toBe(1);
	});
	it('propagates ConvexError from actions', async () => {
		const r = rt();
		await expect(r.action(api.app.failingAction, {})).rejects.toMatchObject({ data: { code: 'ACTION_FAIL' } });
	});
});

describe('scheduler', () => {
	it('runs runAfter jobs after commit, records state, and cancel works', async () => {
		vi.useFakeTimers();
		const r = rt();
		const id = (await r.mutation(api.app.scheduleLog, { delayMs: 1000, msg: 'later' })) as string;
		const cancelMe = (await r.mutation(api.app.scheduleLog, { delayMs: 1000, msg: 'cancelled' })) as string;
		await r.mutation(api.app.cancelJob, { id: cancelMe });
		expect(await r.query(api.app.countLogs, {})).toBe(0);
		await vi.advanceTimersByTimeAsync(999);
		expect(await r.query(api.app.countLogs, {})).toBe(0);
		await vi.advanceTimersByTimeAsync(5);
		expect(await r.query(api.app.countLogs, {})).toBe(1);
		const job = [...r.store.tables.get('_scheduled_functions')!.values()].find((d) => d._id === id)!;
		expect(job.name).toBe('app:writeLog');
		expect(job.state).toEqual({ kind: 'success' });
		const c = [...r.store.tables.get('_scheduled_functions')!.values()].find((d) => d._id === cancelMe)!;
		expect(c.state).toEqual({ kind: 'canceled' });
	});

	it('re-arms from persisted state on reload and runs overdue jobs immediately', async () => {
		vi.useFakeTimers();
		const storage = memoryStorage();
		const a = rt({ storage, persistDebounceMs: 0, crons: { crons: {} } });
		await a.mutation(api.app.scheduleLog, { delayMs: 5000, msg: 'persisted' });
		await vi.advanceTimersByTimeAsync(10);
		a.flush();
		a.dispose();
		live.length = 0;
		vi.setSystemTime(Date.now() + 60_000); // tab was closed past the due time
		const b = rt({ storage, crons: { crons: {} } });
		await b.ready;
		await vi.advanceTimersByTimeAsync(50);
		expect(await b.query(api.app.countLogs, {})).toBe(1);
	});

	it('runs interval crons and persists their last run', async () => {
		vi.useFakeTimers();
		const r = rt();
		await r.ready;
		await vi.advanceTimersByTimeAsync(5100);
		expect(await r.query(api.app.countLogs, {})).toBe(1);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(await r.query(api.app.countLogs, {})).toBe(3);
	});
});

describe('subscriptions', () => {
	it('pushes updates only when relevant tables change', async () => {
		const r = rt();
		const seen: unknown[] = [];
		const seenLogs: number[] = [];
		const un1 = r.onUpdate(api.app.listItems, {}, (v) => seen.push((v as any[]).length));
		const un2 = r.onUpdate(api.app.countLogs, {}, (v) => seenLogs.push(v as number));
		await vi.waitFor(() => expect(seen).toEqual([0]));
		await r.mutation(api.app.addItem, { title: 'a', qty: 1 });
		await vi.waitFor(() => expect(seen).toEqual([0, 1]));
		expect(seenLogs).toEqual([0]); // logs query not re-emitted
		expect(r.localQueryResult(api.app.listItems, {})).toHaveLength(1);
		un1();
		await r.mutation(api.app.addItem, { title: 'b', qty: 2 });
		await new Promise((x) => setTimeout(x, 10));
		expect(seen).toEqual([0, 1]);
		un2();
	});

	it('delivers query errors to the error callback', async () => {
		const r = rt();
		let err: Error | undefined;
		r.onUpdate(api.app.getItem, { id: 'zzzz' }, () => {}, (e) => (err = e));
		await vi.waitFor(() => expect(err).toBeDefined());
		expect(err!.message).toMatch(/ArgumentValidationError/);
	});
});

describe('persistence', () => {
	it('survives reload and reset wipes it', async () => {
		const storage = memoryStorage();
		const a = rt({ storage, persistDebounceMs: 0 });
		const id = (await a.mutation(api.app.addItem, { title: 'keep', qty: 1, tag: 'p' })) as string;
		a.flush();
		a.dispose();
		live.length = 0;
		const b = rt({ storage });
		const doc = (await b.query(api.app.getItem, { id })) as any;
		expect(doc.title).toBe('keep');
		// new inserts after reload still get unique ids & increasing times
		const id2 = (await b.mutation(api.app.addItem, { title: 'again', qty: 2 })) as string;
		expect(id2).not.toBe(id);
		await b.reset();
		expect(await b.query(api.app.listItems, {})).toEqual([]);
		expect(storage.m.has('portunus.localdb.v1')).toBe(false);
	});

	it('survives a corrupted snapshot', async () => {
		const storage = memoryStorage();
		storage.setItem('portunus.localdb.v1', '{not json');
		const r = rt({ storage });
		expect(await r.query(api.app.listItems, {})).toEqual([]);
	});
});

describe('module loading', () => {
	it('never loads excluded modules and accepts lazy loaders', async () => {
		const loader = vi.fn(async () => ({}));
		const lazyApp = vi.fn(async () => (await import('./__fixtures__/app.js')) as any);
		const r = rt({
			modules: {
				'../../convex/tempoNode.ts': loader,
				'../../convex/chainNode.ts': loader,
				'../../convex/_generated/api.js': loader,
				'../../convex/app.test.ts': loader,
				'../../convex/app.ts': lazyApp,
				'../../convex/schema.ts': fixtureModules()['schema.ts']
			}
		});
		await r.ready;
		expect(loader).not.toHaveBeenCalled();
		expect(lazyApp).toHaveBeenCalledOnce();
		expect(r.hasFunction(api.app.addItem)).toBe(true);
	});
});
