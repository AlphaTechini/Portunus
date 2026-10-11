<script lang="ts">
	/** "Held deposit" or "Deposit-free", the same badge on every page and on both sides. */
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import { Badge } from '#lib/ui';

	interface Props {
		mode: 'held' | 'depositFree';
		size?: 'sm' | 'md';
	}
	let { mode, size = 'md' }: Props = $props();
</script>

{#if mode === 'held'}
	<Badge tone="protocol" {size} icon={ShieldCheck} variant="outline">Held deposit</Badge>
{:else}
	<Badge tone="protocol" {size} icon={KeyRound} variant="outline">Deposit-free</Badge>
{/if}
