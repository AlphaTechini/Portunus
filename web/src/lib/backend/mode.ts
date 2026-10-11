import { PUBLIC_CONVEX_URL } from '$app/env/public';
import type { BackendMode } from './types.js';

function convexUrl(): string | undefined {
	try {
		return PUBLIC_CONVEX_URL && PUBLIC_CONVEX_URL.trim() ? PUBLIC_CONVEX_URL.trim() : undefined;
	} catch {
		return undefined;
	}
}

/** 'convex' when PUBLIC_CONVEX_URL is set, otherwise 'local' (in-browser runtime). */
export const backendMode: BackendMode = convexUrl() ? 'convex' : 'local';

export function getConvexUrl(): string | undefined {
	return convexUrl();
}
