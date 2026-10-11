/**
 * Reactive `useQuery` for the local runtime. Same shape and semantics as convex-svelte 0.14:
 * reactive getters `data`, `isLoading`, `error`, `isStale`; `'skip'`; `keepPreviousData`;
 * `initialData`; args may be an object or a closure.
 *
 * Do not wrap in `$derived`; return `'skip'` from the args closure instead.
 */
import { browser } from '$app/env';
import { untrack } from 'svelte';
import type { FunctionArgs, FunctionReference } from 'convex/server';
import type { UseQueryOptions, UseQueryReturn } from './types.js';
import { getLocalRuntime } from './local/browser.js';
import { stableKey } from './local/values.js';

const SKIP = Symbol('portunus.useQuery.skip');
type Args = Record<string, unknown> | typeof SKIP;

function normalize(input: unknown): Args {
	const v = typeof input === 'function' ? (input as () => unknown)() : input;
	if (v === 'skip') return SKIP;
	return $state.snapshot((v ?? {}) as Record<string, unknown>) as Record<string, unknown>;
}

function sameArgs(a: Args, b: Args) {
	if (a === SKIP && b === SKIP) return true;
	if (a === SKIP || b === SKIP) return false;
	return stableKey(a) === stableKey(b);
}

function parseOptions<Q extends FunctionReference<'query'>>(
	options: UseQueryOptions<Q> | (() => UseQueryOptions<Q>)
): UseQueryOptions<Q> {
	return $state.snapshot(typeof options === 'function' ? options() : options) as UseQueryOptions<Q>;
}

export function useLocalQuery<Query extends FunctionReference<'query'>>(
	query: Query,
	args:
		FunctionArgs<Query> | 'skip' | (() => FunctionArgs<Query> | 'skip') = {} as FunctionArgs<Query>,
	options: UseQueryOptions<Query> | (() => UseQueryOptions<Query>) = {}
): UseQueryReturn<Query> {
	if (!browser) {
		// Server render: nothing is available yet.
		const skipped = normalize(args) === SKIP;
		return {
			get data() {
				return undefined;
			},
			get isLoading() {
				return !skipped;
			},
			get error() {
				return undefined;
			},
			get isStale() {
				return false;
			}
		} as UseQueryReturn<Query>;
	}

	const rt = getLocalRuntime();

	const state = $state({
		result: parseOptions(options).initialData as unknown,
		lastResult: undefined as unknown,
		argsForLastResult: undefined as Args | undefined,
		haveArgsEverChanged: false
	});

	// Subscribe; re-subscribe when args change.
	$effect(() => {
		const argsObject = normalize(args);
		if (argsObject === SKIP) {
			state.result = undefined;
			state.argsForLastResult = SKIP;
			return;
		}
		return rt.onUpdate(
			query,
			argsObject,
			(data) => {
				state.result = data;
				state.argsForLastResult = argsObject;
				state.lastResult = data;
			},
			(e) => {
				state.result = e;
				state.argsForLastResult = argsObject;
				state.lastResult = e;
			}
		);
	});

	const currentArgs = $derived(normalize(args));
	const initialArgs = normalize(args);

	const sameArgsAsLastResult = $derived(
		state.argsForLastResult !== undefined &&
			currentArgs !== SKIP &&
			state.argsForLastResult !== SKIP &&
			sameArgs(state.argsForLastResult, currentArgs)
	);
	const staleAllowed = $derived(!!(parseOptions(options).keepPreviousData && state.lastResult));
	const isSkipped = $derived(currentArgs === SKIP);

	// Once args change, move off of initialData.
	$effect(() => {
		if (!untrack(() => state.haveArgsEverChanged)) {
			const curr = normalize(args);
			if (!sameArgs(initialArgs, curr)) {
				state.haveArgsEverChanged = true;
				const opts = parseOptions(options);
				if (opts.initialData !== undefined) {
					state.argsForLastResult = initialArgs === SKIP ? SKIP : $state.snapshot(initialArgs);
					state.lastResult = opts.initialData;
				}
			}
		}
	});

	// Value or Error or undefined (undefined = not loaded yet).
	const syncResult = $derived.by(() => {
		if (isSkipped) return undefined;
		const opts = parseOptions(options);
		if (opts.initialData && !state.haveArgsEverChanged) return state.result;
		let value: unknown;
		try {
			value = rt.localQueryResult(query, currentArgs);
		} catch (e) {
			value = e instanceof Error ? e : new Error(String(e));
		}
		// Touch reactive state so updates retrigger this computation.
		void state.result;
		return value;
	});

	const result = $derived.by(() =>
		syncResult !== undefined ? syncResult : staleAllowed ? state.lastResult : undefined
	);
	const isStale = $derived(
		!isSkipped &&
			syncResult === undefined &&
			staleAllowed &&
			!sameArgsAsLastResult &&
			result !== undefined
	);
	const data = $derived.by(() => (result instanceof Error ? undefined : result));
	const error = $derived.by(() => (result instanceof Error ? result : undefined));

	return {
		get data() {
			return data;
		},
		get isLoading() {
			return isSkipped ? false : error === undefined && data === undefined;
		},
		get error() {
			return error;
		},
		get isStale() {
			return isSkipped ? false : isStale;
		}
	} as UseQueryReturn<Query>;
}
