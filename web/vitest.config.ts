import { defineConfig } from 'vitest/config';

// Backend tests: domain rules, the sim chain and the Convex functions (convex-test).
// Other suites have their own configs: vitest.runtime.config.ts (in-browser runtime),
// vitest.tempo.config.ts (live Tempo helpers).
export default defineConfig({
	test: {
		environment: 'edge-runtime',
		server: { deps: { inline: ['convex-test'] } },
		include: ['tests/backend/**/*.test.ts', 'src/lib/shared/domain/**/*.test.ts', 'src/lib/shared/tempo/sim.test.ts'],
		testTimeout: 60_000,
		hookTimeout: 60_000
	}
});
