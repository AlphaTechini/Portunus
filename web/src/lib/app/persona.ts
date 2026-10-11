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
