import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Tests for the in-browser Convex runtime and backend facade (src/lib/backend).
//  - "runtime": plain Node tests of the Convex emulator.
//  - "svelte": tests that need Svelte runes compiled for the client ($state/$effect).
export default defineConfig({
	plugins: [sveltekit()],
	test: {
		testTimeout: 20_000,
		projects: [
			{
				extends: true,
				test: {
					name: 'runtime',
					environment: 'node',
					include: ['src/lib/backend/**/*.test.ts'],
					exclude: ['src/lib/backend/**/*.svelte.test.ts']
				}
			},
			{
				extends: true,
				resolve: { conditions: ['browser'] },
				test: {
					name: 'svelte',
					environment: './vitest.client-env.ts',
					include: ['src/lib/backend/**/*.svelte.test.ts']
				}
			}
		]
	}
});
