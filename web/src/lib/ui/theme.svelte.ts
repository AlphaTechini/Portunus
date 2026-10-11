/**
 * Theme preference: 'system' follows prefers-color-scheme, otherwise forces
 * [data-theme] on <html>. app.html applies the stored value before first paint.
 */
export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'portunus-theme';

class ThemeStore {
	pref: ThemePref = $state('system');

	init() {
		if (typeof window === 'undefined') return;
		try {
			const v = localStorage.getItem(KEY);
			if (v === 'light' || v === 'dark' || v === 'system') this.pref = v;
		} catch {
			/* storage blocked */
		}
	}

	set(pref: ThemePref) {
		this.pref = pref;
		if (typeof document === 'undefined') return;
		const root = document.documentElement;
		if (pref === 'system') delete root.dataset.theme;
		else root.dataset.theme = pref;
		try {
			localStorage.setItem(KEY, pref);
		} catch {
			/* storage blocked */
		}
	}

	cycle() {
		this.set(this.pref === 'system' ? 'light' : this.pref === 'light' ? 'dark' : 'system');
	}
}

export const theme = new ThemeStore();
