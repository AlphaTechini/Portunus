<script lang="ts">
	import { TEMPO_NETWORK } from './tempo';
	import Tooltip from './Tooltip.svelte';

	interface Props {
		/** Defaults to "Tempo Moderato testnet". */
		label?: string;
		compact?: boolean;
		class?: string;
	}

	let { label = TEMPO_NETWORK.name, compact = false, class: className = '' }: Props = $props();
</script>

<Tooltip
	text="Test network. Amounts and memos are public. Fees are sponsored by Portunus."
	placement="bottom"
>
	<button type="button" class="net {className}" class:compact aria-label="Network: {label}">
		<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
			<path d="M5 .8 9.2 5 5 9.2.8 5Z" fill="none" stroke="currentColor" stroke-width="1.2" />
		</svg>
		<span class="txt">{compact ? TEMPO_NETWORK.short : label}</span>
	</button>
</Tooltip>

<style>
	.net {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 1.625rem;
		padding: 0 var(--space-2-5);
		border: 1px dashed var(--color-border-strong);
		border-radius: var(--radius-full);
		color: var(--color-text-secondary);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		white-space: nowrap;
		cursor: help;
	}

	.net svg {
		color: var(--color-accent);
	}

	.net:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
	}
</style>
