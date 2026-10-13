/** Remembers which demo persona the presenter last used per role, so the role switch is symmetric. */
import type { AppRole } from './routes';

const key = (role: AppRole) => `portunus.persona.${role}`;

export function rememberPersona(role: AppRole, userId: string): void {
	try {
		localStorage.setItem(key(role), userId);
	} catch {
		/* storage unavailable */
	}
}

export function recallPersona(role: AppRole): string | null {
	try {
		return localStorage.getItem(key(role));
	} catch {
		return null;
	}
}

const parkedKey = (role: AppRole) => `portunus.parked.${role}`;

/**
 * Keeps a signed-in session for `role` while the presenter switches to the other side, so switching
 * back reuses it instead of asking for the passkey again.
 */
export function parkSession(role: AppRole, token: string): void {
	try {
		localStorage.setItem(parkedKey(role), token);
	} catch {
		/* storage unavailable */
	}
}

export function parkedSession(role: AppRole): string | null {
	try {
		return localStorage.getItem(parkedKey(role));
	} catch {
		return null;
	}
}

/** Removes and returns every parked session token (for sign-out). */
export function takeParkedSessions(): string[] {
	const out: string[] = [];
	for (const role of ['line', 'importer', 'platform'] as AppRole[]) {
		const t = parkedSession(role);
		if (t) out.push(t);
		try {
			localStorage.removeItem(parkedKey(role));
		} catch {
			/* storage unavailable */
		}
	}
	return out;
}

export function unparkSession(role: AppRole): void {
	try {
		localStorage.removeItem(parkedKey(role));
	} catch {
		/* storage unavailable */
	}
}
