<script lang="ts">
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import Monitor from '@lucide/svelte/icons/monitor';
	import IconButton from './IconButton.svelte';
	import { theme } from './theme.svelte';

	interface Props {
		size?: 'sm' | 'md';
	}
	let { size = 'md' }: Props = $props();

	$effect(() => theme.init());

	const icon = $derived(theme.pref === 'light' ? Sun : theme.pref === 'dark' ? Moon : Monitor);
	const label = $derived(
		theme.pref === 'system'
			? 'Theme: system. Switch to light'
			: theme.pref === 'light'
				? 'Theme: light. Switch to dark'
				: 'Theme: dark. Switch to system'
	);
</script>

<IconButton {icon} {label} {size} onclick={() => theme.cycle()} />
