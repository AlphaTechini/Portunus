import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * Lets the real Convex function modules (`src/convex/**`) be bundled for the browser, where
 * they run inside the in-browser Convex runtime (`src/lib/backend/local`).
 *
 * `./_generated/server` is redirected to a shim because SvelteKit's guard forbids bundling
 * any file called `server.*` into client code (and the generated file touches `process.env`
 * at import time). Convex's own tooling (`npx convex dev/deploy/codegen`) is unaffected: it
 * does not go through Vite.
 */
export function portunusLocalBackend(): Plugin {
	const shim = fileURLToPath(
		new URL('../src/lib/backend/local/convexServerShim.ts', import.meta.url)
	);
	const convexDir = /[\\/]src[\\/]convex[\\/]/;
	const generatedServer = /(^|[\\/])_generated[\\/]server(\.js)?$/;
	return {
		name: 'portunus-local-backend',
		enforce: 'pre',
		resolveId(source, importer) {
			if (!importer || !convexDir.test(importer)) return null;
			return generatedServer.test(source) ? shim : null;
		}
	};
}
