import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server';

export type BackendMode = 'convex' | 'local';

export type { UseQueryOptions, UseQueryReturn } from 'convex-svelte';

/** Imperative client, identical in both modes. */
export interface Backend {
	readonly mode: BackendMode;
	/** Resolves when the backend can serve requests (local: modules loaded, seeded). */
	readonly ready: Promise<void>;
	query<Q extends FunctionReference<'query'>>(
		query: Q,
		args?: FunctionArgs<Q>
	): Promise<FunctionReturnType<Q>>;
	mutation<M extends FunctionReference<'mutation'>>(
		mutation: M,
		args?: FunctionArgs<M>
	): Promise<FunctionReturnType<M>>;
	action<A extends FunctionReference<'action'>>(
		action: A,
		args?: FunctionArgs<A>
	): Promise<FunctionReturnType<A>>;
	/** Live subscription. Returns an unsubscribe function. */
	subscribe<Q extends FunctionReference<'query'>>(
		query: Q,
		args: FunctionArgs<Q>,
		onResult: (value: FunctionReturnType<Q>) => void,
		onError?: (error: Error) => void
	): () => void;
}
