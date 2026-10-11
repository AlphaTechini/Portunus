import { backendMode } from './mode.js';

/** Reactive readiness of the backend (local: modules loaded and demo data seeded). */
export const backendStatus = $state<{ ready: boolean; error: string | null }>({
	ready: backendMode === 'convex',
	error: null
});
