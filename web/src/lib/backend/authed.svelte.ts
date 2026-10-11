/** Session-aware wrappers around the facade hooks: they inject `sessionToken`. */
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server';
import { useAction, useMutation, useQuery } from './client.js';
import { session } from './session.svelte.js';
import type { UseQueryOptions, UseQueryReturn } from './types.js';

type WithoutToken<A> = Omit<A, 'sessionToken'>;
type AuthedArgs<F extends FunctionReference<any>> = WithoutToken<FunctionArgs<F>>;

/**
 * Like `useQuery`, but injects `sessionToken` into the args and skips the query while
 * there is no session. `args` may be an object, `'skip'`, or a closure returning either.
 */
export function useAuthedQuery<Query extends FunctionReference<'query'>>(
	query: Query,
	args: AuthedArgs<Query> | 'skip' | (() => AuthedArgs<Query> | 'skip') = {} as AuthedArgs<Query>,
	options: UseQueryOptions<Query> | (() => UseQueryOptions<Query>) = {}
): UseQueryReturn<Query> {
	return useQuery(
		query,
		() => {
			const token = session.token;
			if (!token) return 'skip';
			const a = typeof args === 'function' ? args() : args;
			if (a === 'skip') return 'skip';
			return { ...(a as object), sessionToken: token } as FunctionArgs<Query>;
		},
		options
	);
}

/** `useMutation` that adds the current `sessionToken` to the args. */
export function useAuthedMutation<M extends FunctionReference<'mutation'>>(mutation: M) {
	const run = useMutation(mutation);
	return (args?: AuthedArgs<M>): Promise<FunctionReturnType<M>> =>
		run({ ...((args ?? {}) as object), sessionToken: session.token } as FunctionArgs<M>);
}

/** `useAction` that adds the current `sessionToken` to the args. */
export function useAuthedAction<A extends FunctionReference<'action'>>(action: A) {
	const run = useAction(action);
	return (args?: AuthedArgs<A>): Promise<FunctionReturnType<A>> =>
		run({ ...((args ?? {}) as object), sessionToken: session.token } as FunctionArgs<A>);
}
