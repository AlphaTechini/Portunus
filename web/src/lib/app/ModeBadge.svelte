<script lang="ts">
	/** "Held deposit" or "Deposit-free", the same badge on every page. */
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import { Badge } from '#lib/ui';
	import { MODE_LABEL, type DepositMode } from './containerUi';

	let { mode, size = 'md' }: { mode: DepositMode; size?: 'sm' | 'md' } = $props();
</script>

<Badge
	tone={mode === 'held' ? 'protocol' : 'info'}
	variant="outline"
	{size}
	icon={mode === 'held' ? ShieldCheck : KeyRound}
>
	{MODE_LABEL[mode]}
</Badge>
