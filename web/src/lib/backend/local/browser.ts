/**
 * Browser wiring of the local runtime: real Convex modules via `import.meta.glob`,
 * localStorage, BroadcastChannel and navigator.locks. Never touches `window` at import time.
 */
import { anyApi } from 'convex/server';
import { LocalRuntime, type LocalRuntimeOptions, type ModuleMap } from './runtime.js';
import type { ChannelLike, StorageLike } from './platform.js';
import type { LocksLike } from './election.js';

/**
 * All Convex function modules, loaded lazily. `"use node"` files are excluded by name
 * (`tempoNode.ts`, anything ending in `Node.ts`); the runtime also skips them by name.
 */
const convexModules = import.meta.glob([
	'../../../convex/**/*.ts',
	'!../../../convex/**/_generated/**',
	'!../../../convex/**/*.d.ts',
	'!../../../convex/**/*.test.ts',
	'!../../../convex/**/*.spec.ts',
	'!../../../convex/**/*Node.ts'
]) as ModuleMap;

// Kept on globalThis so Vite HMR does not create a second runtime (and a second leader) per tab.
const KEY = '__portunus_local_runtime__';
const g = globalThis as unknown as Record<string, LocalRuntime | null | undefined>;
let runtime: LocalRuntime | null = null;

function safeStorage(): StorageLike | null {
	try {
		const s = window.localStorage;
		const k = '__portunus_probe__';
		s.setItem(k, '1');
		s.removeItem(k);
		return s;
	} catch {
		return null;
	}
}

/** Build a runtime wired to the real browser APIs. `overrides` is for tests. */
export function createBrowserRuntime(overrides: Partial<LocalRuntimeOptions> = {}): LocalRuntime {
	const storage = safeStorage();
	const locks = (navigator as { locks?: LocksLike }).locks ?? null;
	const canSync = typeof BroadcastChannel !== 'undefined' && (locks || storage);
	return new LocalRuntime({
		modules: convexModules,
		storage,
		locks,
		leader: 'auto',
		createChannel: canSync ? (name) => new BroadcastChannel(name) as unknown as ChannelLike : null,
		afterBoot: async (boot) => {
			// Seed demo data once (idempotent). Followers forward to the leader.
			const ensure = anyApi.seed.ensure;
			if (boot.hasFunction(ensure)) await boot.mutation(ensure, {});
		},
		...overrides
	});
}

export function getLocalRuntime(): LocalRuntime {
	runtime ??= g[KEY] ?? null;
	if (runtime) return runtime;
	if (typeof window === 'undefined') {
		throw new Error('The local backend only runs in the browser.');
	}
	runtime = createBrowserRuntime();
	g[KEY] = runtime;
	return runtime;
}

/** Test hook: use a specific runtime as the singleton. */
export function setLocalRuntime(rt: LocalRuntime | null) {
	runtime = rt;
	g[KEY] = rt;
}

/** True once the runtime has been created (without creating it). */
export function hasLocalRuntime() {
	return (runtime ?? g[KEY] ?? null) !== null;
}

export function disposeLocalRuntime() {
	(runtime ?? g[KEY])?.dispose();
	runtime = null;
	g[KEY] = null;
}
