import { defineConfig } from 'vitest/config';

// Tempo live tests that need Node (solc, fs, a JS EVM). Pure helper tests in src/lib/shared/tempo also run
// here, in Node. The default config runs the same shared tests in the edge runtime.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['scripts/**/*.test.ts', 'src/lib/shared/tempo/**/*.test.ts'],
		testTimeout: 60_000
	}
});
