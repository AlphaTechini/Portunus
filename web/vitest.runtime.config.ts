import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Tests for the in-browser Convex runtime and backend facade (src/lib/backend).
export default defineConfig({
	plugins: [sveltekit()],
	resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
	test: {
		environment: 'node',
		include: ['src/lib/backend/**/*.test.ts'],
		testTimeout: 20_000
	}
});
