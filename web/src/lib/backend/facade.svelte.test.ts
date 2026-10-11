// Runs in the 'svelte' vitest project (client-compiled runes), see vitest.runtime.config.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';

vi.mock('$app/env', () => ({ browser: true, dev: true, building: false, version: 'test' }));
vi.mock('$app/env/public', () => ({ PUBLIC_CONVEX_URL: undefined }));

import { api, fixtureModules, makeRuntime } from './local/__fixtures__/helpers.js';
import { setLocalRuntime } from './local/browser.js';
import { useLocalQuery } from './query.svelte.js';
import { session, setSession, clearSession } from './session.svelte.js';
import { useAuthedQuery } from './authed.svelte.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
	setLocalRuntime(null);
});

describe('useLocalQuery', () => {
	it('is reactive: loading -> data -> updates on writes; skip and keepPreviousData', async () => {
		const rt = makeRuntime({ crons: { crons: {} } });
		setLocalRuntime(rt);
		let tag = $state<string | undefined>(undefined);
		let skip = $state(false);
		let q!: ReturnType<typeof useLocalQuery<any>>;
		const stop = $effect.root(() => {
			q = useLocalQuery(api.app.listItems, () => (skip ? 'skip' : tag ? { tag } : {}), {
				keepPreviousData: true
			});
		});
		expect(q.isLoading).toBe(true);
		expect(q.data).toBeUndefined();

		await expect.poll(() => (flushSync(), q.isLoading)).toBe(false);
		expect(q.data).toEqual([]);

		await rt.mutation(api.app.addItem, { title: 'a', qty: 1, tag: 'x' });
		await rt.mutation(api.app.addItem, { title: 'b', qty: 2, tag: 'y' });
		await expect.poll(() => (flushSync(), q.data?.length)).toBe(2);

		// args change -> stale previous data while loading, then fresh data
		tag = 'x';
		flushSync();
		await expect.poll(() => (flushSync(), q.data?.map((d: any) => d.title))).toEqual(['a']);
		expect(q.isStale).toBe(false);

		skip = true;
		flushSync();
		expect(q.isLoading).toBe(false);
		expect(q.isStale).toBe(false);
		// keepPreviousData: the last result stays visible while skipped (same as convex-svelte)
		expect(q.data).toHaveLength(1);
		skip = false;
		flushSync();
		await expect.poll(() => (flushSync(), q.data?.length)).toBe(1);

		stop();
	});

	it('exposes errors via .error', async () => {
		const rt = makeRuntime({ crons: { crons: {} } });
		setLocalRuntime(rt);
		let q!: ReturnType<typeof useLocalQuery<any>>;
		const stop = $effect.root(() => {
			q = useLocalQuery(api.app.getItem, { id: 'not-an-id' });
		});
		await expect.poll(() => (flushSync(), q.error?.message)).toMatch(/ArgumentValidationError/);
		expect(q.isLoading).toBe(false);
		stop();
	});
});

describe('session + useAuthedQuery', () => {
	it('skips without token and injects sessionToken once signed in', async () => {
		vi.stubGlobal('window', {
			localStorage: {
				m: new Map<string, string>(),
				getItem(k: string) {
					return this.m.get(k) ?? null;
				},
				setItem(k: string, v: string) {
					this.m.set(k, v);
				},
				removeItem(k: string) {
					this.m.delete(k);
				}
			},
			sessionStorage: {
				m: new Map<string, string>(),
				getItem(k: string) {
					return this.m.get(k) ?? null;
				},
				setItem(k: string, v: string) {
					this.m.set(k, v);
				},
				removeItem(k: string) {
					this.m.delete(k);
				}
			}
		});
		const { mutationGeneric, queryGeneric } = await import('convex/server');
		const { v } = await import('convex/values');
		const whoami = queryGeneric({
			args: { sessionToken: v.string() },
			handler: async (_c, a) => `user:${a.sessionToken}`
		});
		const rt = makeRuntime({
			crons: { crons: {} },
			modules: {
				'who.ts': { whoami, nop: mutationGeneric({ args: {}, handler: async () => null }) }
			}
		});
		setLocalRuntime(rt);
		clearSession();

		let q!: ReturnType<typeof useAuthedQuery<any>>;
		const stop = $effect.root(() => {
			q = useAuthedQuery(api.who.whoami, () => ({}));
		});
		flushSync();
		expect(q.isLoading).toBe(false); // skipped
		expect(q.data).toBeUndefined();

		setSession('tok123');
		flushSync();
		await expect.poll(() => (flushSync(), q.data)).toBe('user:tok123');
		expect(window.localStorage.getItem('portunus.session')).toBe('tok123');
		expect(window.sessionStorage.getItem('portunus.session')).toBe('tok123');

		clearSession();
		flushSync();
		expect(session.token).toBeNull();
		expect(window.localStorage.getItem('portunus.session')).toBeNull();
		stop();
		vi.unstubAllGlobals();
		await sleep(0);
	});
});

describe('imperative facade', () => {
	it('getBackend() works in local mode and resetLocalDb wipes, clears the session and reseeds', async () => {
		const { mutationGeneric, queryGeneric } = await import('convex/server');
		const { getBackend, resetLocalDb, backendMode } = await import('./client.js');
		const seed = {
			ensure: mutationGeneric({
				args: {},
				handler: async (ctx) => {
					const any = await ctx.db.query('items').first();
					if (!any) await ctx.db.insert('items', { title: 'seeded', qty: 1 });
					return null;
				}
			})
		};
		const rt = makeRuntime({
			crons: { crons: {} },
			modules: {
				...fixtureModules(),
				'seed.ts': seed,
				'q.ts': {
					n: queryGeneric({
						args: {},
						handler: async (ctx) => (await ctx.db.query('items').collect()).length
					})
				}
			}
		});
		setLocalRuntime(rt);
		vi.stubGlobal('window', {
			localStorage: { removeItem() {}, setItem() {}, getItem: () => null },
			sessionStorage: { removeItem() {}, setItem() {}, getItem: () => null }
		});
		expect(backendMode).toBe('local');
		const b = getBackend();
		expect(b.mode).toBe('local');
		await b.mutation(api.app.addItem, { title: 'mine', qty: 3 });
		const seen: number[] = [];
		const un = b.subscribe(api.q.n, {}, (n: number) => seen.push(n));
		await expect.poll(() => seen.at(-1)).toBe(1);
		setSession('abc');
		await resetLocalDb();
		expect(session.token).toBeNull();
		await expect.poll(() => seen.at(-1)).toBe(1); // wiped, then reseeded: exactly one item
		expect(((await b.query(api.app.listItems, {})) as any[]).map((d) => d.title)).toEqual([
			'seeded'
		]);
		un();
		vi.unstubAllGlobals();
	});
});
