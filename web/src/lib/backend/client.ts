/**
 * Backend facade: identical API whether the data lives in Convex cloud (`convex-svelte`)
 * or in the in-browser Convex runtime (`./local`).
 */
import { browser } from '$app/env';
import { anyApi } from 'convex/server';
import type { MutationOptions } from 'convex/browser';
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server';
import {
	getConvexClient,
	setupConvex,
	useAction as convexUseAction,
	useMutation as convexUseMutation,
	useQuery as convexUseQuery
} from 'convex-svelte';
import { backendMode, getConvexUrl } from './mode.js';
import { backendStatus } from './status.svelte.js';
import { clearSession } from './session.svelte.js';
import { useLocalQuery } from './query.svelte.js';
import { getLocalRuntime, hasLocalRuntime } from './local/browser.js';
import type { Backend, UseQueryOptions, UseQueryReturn } from './types.js';

export { backendMode };
export type { Backend, BackendMode, UseQueryOptions, UseQueryReturn } from './types.js';

/**
 * Call once, during root layout component initialisation (`+layout.svelte`).
 *
 *  - convex mode: `setupConvex(PUBLIC_CONVEX_URL)`.
 *  - local mode: starts the in-browser runtime (loads the Convex modules, restores the
 *    persisted database, elects the leader tab) and runs `seed.ensure` once if it exists.
 *    `setupConvex` is never called.
 */
export function setupBackend(): void {
	if (backendMode === 'convex') {
		setupConvex(getConvexUrl()!);
		return;
	}
	if (!browser) return;
	const rt = getLocalRuntime();
	if (!backendStatus.ready) {
		rt.ready.then(
			() => {
				backendStatus.ready = true;
			},
			(e) => {
				backendStatus.error = e instanceof Error ? e.message : String(e);
				backendStatus.ready = true;
			}
		);
	}
}

export function useQuery<Query extends FunctionReference<'query'>>(
	query: Query,
	args: FunctionArgs<Query> | 'skip' | (() => FunctionArgs<Query> | 'skip') = {} as FunctionArgs<Query>,
	options: UseQueryOptions<Query> | (() => UseQueryOptions<Query>) = {}
): UseQueryReturn<Query> {
	return backendMode === 'convex'
		? convexUseQuery(query, args, options)
		: useLocalQuery(query, args, options);
}

export function useMutation<M extends FunctionReference<'mutation'>>(
	mutation: M
): (args?: FunctionArgs<M>, options?: MutationOptions) => Promise<FunctionReturnType<M>> {
	if (backendMode === 'convex') {
		const run = convexUseMutation(mutation);
		return (args, options) => run((args ?? {}) as FunctionArgs<M>, options);
	}
	// Local mode: results arrive through live queries, optimistic updates are not needed.
	return (args) => getBackend().mutation(mutation, args);
}

export function useAction<A extends FunctionReference<'action'>>(
	action: A
): (args?: FunctionArgs<A>) => Promise<FunctionReturnType<A>> {
	if (backendMode === 'convex') {
		const run = convexUseAction(action);
		return (args) => run((args ?? {}) as FunctionArgs<A>);
	}
	return (args) => getBackend().action(action, args);
}

let localBackend: Backend | null = null;

/** Imperative access (event handlers, load functions, plain .ts modules). */
export function getBackend(): Backend {
	if (backendMode === 'convex') {
		const client = getConvexClient();
		return {
			mode: 'convex',
			ready: Promise.resolve(),
			query: (q, a) => client.query(q, (a ?? {}) as never) as never,
			mutation: (m, a) => client.mutation(m, (a ?? {}) as never) as never,
			action: (m, a) => client.action(m, (a ?? {}) as never) as never,
			subscribe: (q, a, cb, err) => client.onUpdate(q, a as never, cb as never, err)
		};
	}
	if (localBackend) return localBackend;
	const rt = () => getLocalRuntime();
	localBackend = {
		mode: 'local',
		get ready() {
			return browser ? rt().ready : new Promise<void>(() => {});
		},
		query: (q, a) => rt().query(q, a) as never,
		mutation: (m, a) => rt().mutation(m, a) as never,
		action: (m, a) => rt().action(m, a) as never,
		subscribe: (q, a, cb, err) => rt().onUpdate(q, a, cb as (v: unknown) => void, err)
	};
	return localBackend;
}

/**
 * Local mode only: wipe the in-browser database (every open tab), clear the session and
 * seed demo data again. No-op (with a warning) in convex mode.
 */
export async function resetLocalDb(options: { reseed?: boolean; clearSession?: boolean } = {}): Promise<void> {
	if (backendMode !== 'local') {
		console.warn('resetLocalDb() only applies to the local backend.');
		return;
	}
	if (!browser) return;
	const rt = getLocalRuntime();
	await rt.reset();
	if (options.clearSession !== false) clearSession();
	if (options.reseed !== false && rt.hasFunction(anyApi.seed.ensure)) {
		await rt.mutation(anyApi.seed.ensure, {});
	}
}

export { hasLocalRuntime };
