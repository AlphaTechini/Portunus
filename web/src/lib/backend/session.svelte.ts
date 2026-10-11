/**
 * Session token store.
 *
 * The token is persisted in `localStorage['portunus.session']` (so a new tab starts signed
 * in as the most recent login). It is also kept in `sessionStorage` of the tab that signed
 * in, and that copy wins: with two tabs you can be signed in as two different personas at
 * the same time (importer in one tab, shipping line in the other) without them swapping.
 */
import { browser } from '$app/env';

export const SESSION_KEY = 'portunus.session';

function read(): string | null {
	try {
		return window.sessionStorage.getItem(SESSION_KEY) ?? window.localStorage.getItem(SESSION_KEY);
	} catch {
		return null;
	}
}

function write(token: string | null) {
	for (const area of ['sessionStorage', 'localStorage'] as const) {
		try {
			const s = window[area];
			if (token) s.setItem(SESSION_KEY, token);
			else s.removeItem(SESSION_KEY);
		} catch {
			/* storage unavailable: keep the in-memory value */
		}
	}
}

/** Reactive session. Read `session.token` anywhere (it is `$state`). */
export const session = $state<{ token: string | null }>({ token: browser ? read() : null });

export function setSession(token: string) {
	session.token = token;
	if (browser) write(token);
}

export function clearSession() {
	session.token = null;
	if (browser) write(null);
}
