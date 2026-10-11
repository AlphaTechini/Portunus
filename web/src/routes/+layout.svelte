<script lang="ts">
	import '#lib/ui/tokens.css';
	import '#lib/ui/global.css';
	import favicon from '#lib/assets/favicon.svg';
	import { Toaster } from '#lib/ui';
	import { setupBackend } from '#lib/backend';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	// Starts the in-browser Convex runtime (local mode) or connects to Convex (PUBLIC_CONVEX_URL).
	setupBackend();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#f7f8fa" media="(prefers-color-scheme: light)" />
	<meta name="theme-color" content="#0b0d11" media="(prefers-color-scheme: dark)" />
</svelte:head>

{@render children()}

<Toaster />
