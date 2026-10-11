import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	/**
	 * URL of a Convex deployment. When unset (the default), Portunus runs against the
	 * in-browser Convex runtime in `src/lib/backend/local` and works fully offline.
	 */
	PUBLIC_CONVEX_URL: {
		public: true,
		schema: (value) => (value && value.trim() ? value.trim() : undefined),
		description: 'Convex deployment URL. Unset = in-browser local backend.'
	}
});
