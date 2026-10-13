import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { portunusLocalBackend } from './vite-plugins/portunusLocalBackend.ts';

export default defineConfig({
	plugins: [
		portunusLocalBackend(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Deployed on Vercel (project root: web/).
			adapter: adapter()
		})
	]
});
