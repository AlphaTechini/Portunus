// Vitest environment that behaves like a browser for Vite's module transforms
// (so Svelte compiles runes for the client), without needing jsdom.
export default {
	name: 'portunus-client',
	viteEnvironment: 'client',
	setup() {
		return { teardown() {} };
	}
};
