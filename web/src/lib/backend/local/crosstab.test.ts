// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { api, makeRuntime, memoryStorage } from './__fixtures__/helpers.js';
import type { LocalRuntime } from './runtime.js';
import type { LocksLike } from './election.js';

/** A tiny in-process model of navigator.locks (exclusive, ifAvailable, queueing). */
class FakeLocks implements LocksLike {
	private held = new Set<string>();
	private waiters = new Map<string, Array<() => void>>();
	request(name: string, a: any, b?: any): Promise<unknown> {
		const opts = typeof a === 'function' ? {} : a;
		const cb = typeof a === 'function' ? a : b;
		const run = async () => {
			this.held.add(name);
			try {
				return await cb({ name });
			} finally {
				this.held.delete(name);
				const next = this.waiters.get(name)?.shift();
				next?.();
			}
		};
		if (!this.held.has(name)) return run();
		if (opts.ifAvailable) return Promise.resolve(cb(null));
		return new Promise((resolve) => {
			const q = this.waiters.get(name) ?? [];
			q.push(() => void run().then(resolve));
			this.waiters.set(name, q);
		});
	}
}

const tabs: LocalRuntime[] = [];
afterEach(() => {
	while (tabs.length) tabs.pop()!.dispose();
});

let chanSeq = 0;
function tab(locks: FakeLocks, name: string, storage = memoryStorage()) {
	const r = makeRuntime({
		leader: 'auto',
		locks,
		storage,
		persistDebounceMs: 0,
		channelName: name,
		createChannel: (n) => new BroadcastChannel(n) as never,
		crons: { crons: {} }
	});
	tabs.push(r);
	return r;
}

describe('cross-tab', () => {
	it('elects one leader, forwards follower writes, replicates and notifies', async () => {
		const locks = new FakeLocks();
		const name = `test-${++chanSeq}`;
		const a = tab(locks, name);
		await a.ready;
		const b = tab(locks, name);
		await b.ready;
		expect(a.role).toBe('leader');
		expect(b.role).toBe('follower');

		const seenB: number[] = [];
		b.onUpdate(api.app.listItems, {}, (v) => seenB.push((v as any[]).length));
		await new Promise((r) => setTimeout(r, 30));

		// write through the follower: executed by the leader, returned to the follower
		const id = (await b.mutation(api.app.addItem, { title: 'from-b', qty: 1 })) as string;
		expect(id).toHaveLength(32);
		// leader has it
		expect(((await a.query(api.app.listItems, {})) as any[]).map((d) => d.title)).toEqual(['from-b']);
		// follower replica has it, and its subscription fired
		await expect.poll(async () => ((await b.query(api.app.listItems, {})) as any[]).length).toBe(1);
		await expect.poll(() => seenB.at(-1)).toBe(1);

		// errors cross the tab boundary with ConvexError data intact
		await expect(b.mutation(api.app.failAfterWrite, {})).rejects.toMatchObject({ data: { code: 'NOPE' } });
		// action through follower
		expect(await b.action(api.app.slowAction, { n: 2 })).toBe(3);
		await expect.poll(async () => ((await b.query(api.app.listItems, {})) as any[]).length).toBe(3);
	});

	it('hands over to the follower when the leader goes away, without losing data', async () => {
		const locks = new FakeLocks();
		const name = `test-${++chanSeq}`;
		const storage = memoryStorage();
		const a = tab(locks, name, storage);
		await a.ready;
		const b = tab(locks, name, storage);
		await b.ready;
		await a.mutation(api.app.addItem, { title: 'one', qty: 1 });
		await expect.poll(async () => ((await b.query(api.app.listItems, {})) as any[]).length).toBe(1);

		a.dispose(); // simulates the leader tab closing (releases the lock)
		await expect.poll(() => b.role).toBe('leader');
		await b.mutation(api.app.addItem, { title: 'two', qty: 2 });
		expect(((await b.query(api.app.listItems, {})) as any[]).map((d) => d.title)).toEqual(['one', 'two']);

		// a new tab joins and gets the full state from the new leader
		const c = tab(locks, name, memoryStorage());
		await c.ready;
		expect(c.role).toBe('follower');
		await expect.poll(async () => ((await c.query(api.app.listItems, {})) as any[]).length).toBe(2);
	});

	it('reset propagates to every tab', async () => {
		const locks = new FakeLocks();
		const name = `test-${++chanSeq}`;
		const a = tab(locks, name);
		const b = tab(locks, name);
		await Promise.all([a.ready, b.ready]);
		const [lead, follow] = a.role === 'leader' ? [a, b] : [b, a];
		await lead.mutation(api.app.addItem, { title: 'x', qty: 1 });
		await expect.poll(async () => ((await follow.query(api.app.listItems, {})) as any[]).length).toBe(1);
		await follow.reset();
		await expect.poll(async () => ((await follow.query(api.app.listItems, {})) as any[]).length).toBe(0);
		expect(await lead.query(api.app.listItems, {})).toEqual([]);
	});

	it('works without navigator.locks via the storage heartbeat', async () => {
		const name = `test-${++chanSeq}`;
		const storage = memoryStorage();
		const mk = () => {
			const r = makeRuntime({
				leader: 'auto',
				locks: null,
				storage,
				persistDebounceMs: 0,
				channelName: name,
				createChannel: (n) => new BroadcastChannel(n) as never,
				crons: { crons: {} }
			});
			tabs.push(r);
			return r;
		};
		const a = mk();
		await a.ready;
		const b = mk();
		await b.ready;
		expect([a.role, b.role].sort()).toEqual(['follower', 'leader']);
	});
});
