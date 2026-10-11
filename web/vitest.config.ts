import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'edge-runtime',
		server: { deps: { inline: ['convex-test'] } },
		include: ['tests/**/*.test.ts', 'src/lib/shared/**/*.test.ts'],
		testTimeout: 30_000
	}
});
