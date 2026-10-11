/**
 * Stand-in for `src/convex/_generated/server.js` inside the browser bundle.
 *
 * SvelteKit refuses to bundle any file named `server.*` into client code, and the generated
 * file also reads `process.env` at import time. The Vite plugin in
 * `vite-plugins/portunusLocalBackend.ts` redirects `./_generated/server` imports made from
 * `src/convex/**` to this file. The exports mirror the generated file exactly.
 */
import {
	actionGeneric,
	httpActionGeneric,
	internalActionGeneric,
	internalMutationGeneric,
	internalQueryGeneric,
	mutationGeneric,
	queryGeneric
} from 'convex/server';

export const query = queryGeneric;
export const internalQuery = internalQueryGeneric;
export const mutation = mutationGeneric;
export const internalMutation = internalMutationGeneric;
export const action = actionGeneric;
export const internalAction = internalActionGeneric;
export const httpAction = httpActionGeneric;

/** `process.env` of the Convex deployment; in the local runtime it is filled by LocalRuntime. */
export const env: Record<string, string | undefined> = new Proxy(
	{},
	{
		get: (_t, key) =>
			typeof key === 'string'
				? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key]
				: undefined
	}
);
