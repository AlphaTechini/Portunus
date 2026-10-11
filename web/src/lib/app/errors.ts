/**
 * Error helpers for pages.
 *
 * Backend functions throw `ConvexError({ code, message })`, so the user-facing text is in
 * `e.data.message`. Passkey failures are `PasskeyError` (plain `message`). Anything else is an
 * unexpected failure and gets a generic sentence so internals never leak into the UI.
 */

export const GENERIC_ERROR = 'Something went wrong. Try again in a moment.';

interface ErrorLike {
	data?: unknown;
	message?: unknown;
	name?: unknown;
	code?: unknown;
}

/** Backend error code (`UNAUTHENTICATED`, `INVALID_STATE`, ...) or the PasskeyError code. */
export function errorCode(e: unknown): string | undefined {
	const x = e as ErrorLike | null;
	const data = x?.data;
	if (data && typeof data === 'object' && 'code' in data)
		return String((data as { code: unknown }).code);
	if (typeof x?.code === 'string') return x.code;
	return undefined;
}

/** The sentence to show the user for any thrown value. */
export function errorMessage(e: unknown, fallback: string = GENERIC_ERROR): string {
	const x = e as ErrorLike | null;
	const data = x?.data;
	if (typeof data === 'string' && data) return data;
	if (data && typeof data === 'object' && 'message' in data) {
		const m = (data as { message: unknown }).message;
		if (typeof m === 'string' && m) return m;
	}
	if (x?.name === 'PasskeyError' || x?.name === 'ApprovalCancelledError') {
		if (typeof x.message === 'string' && x.message) return x.message;
	}
	return fallback;
}

/** True when the user closed the approval sheet (not an error worth a toast). */
export function isApprovalCancelled(e: unknown): boolean {
	return (e as ErrorLike | null)?.name === 'ApprovalCancelledError';
}

export class ApprovalCancelledError extends Error {
	constructor() {
		super('Approval cancelled.');
		this.name = 'ApprovalCancelledError';
	}
}
