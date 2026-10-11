/**
 * Backend facade. Import everything from `$lib/backend`.
 *
 *   setupBackend()                       root layout, once
 *   useQuery(ref, argsOrFn, opts)        reactive: { data, isLoading, error, isStale }
 *   useMutation(ref) / useAction(ref)    (args) => Promise
 *   useAuthedQuery(ref, argsOrFn, opts)  injects sessionToken, 'skip' while signed out
 *   session / setSession / clearSession  token store (localStorage 'portunus.session')
 *   getBackend()                         imperative query/mutation/action/subscribe
 *   backendMode                          'convex' | 'local'
 *   resetLocalDb()                       local mode: wipe + reseed
 */
export {
	setupBackend,
	useQuery,
	useMutation,
	useAction,
	getBackend,
	resetLocalDb,
	backendMode
} from './client.js';
export type { Backend, BackendMode, UseQueryOptions, UseQueryReturn } from './types.js';
export { session, setSession, clearSession, SESSION_KEY } from './session.svelte.js';
export { useAuthedQuery, useAuthedMutation, useAuthedAction } from './authed.svelte.js';
export { backendStatus } from './status.svelte.js';
