<script lang="ts">
	/**
	 * Shows the outcome of a transaction: finality time and the hash. On the simulated chain the hash
	 * is shown with a `sim:` prefix and no explorer link; live it links to the explorer.
	 *
	 *   <ChainResult txHash={r.txHash} finalityMs={r.finalityMs} toastTitle="Deposit held by protocol" />
	 *
	 * `toastTitle` fires `toast.protocol` once when the component mounts, so mount it when the
	 * result arrives (inside an `{#if result}` block).
	 */
	import { onMount } from 'svelte';
	import Zap from '@lucide/svelte/icons/zap';
	import { Hash, TempoTag, formatFinality, toast } from '#lib/ui';
	import { useApp } from './ctx.svelte';

	interface Props {
		txHash: string;
		finalityMs?: number;
		/** Override the app's chain mode (e.g. a stored payment row has its own `mode`). */
		mode?: 'sim' | 'live';
		/** Fire `toast.protocol` with this title on mount. */
		toastTitle?: string;
		toastDescription?: string;
		/** Show the "Final in about 0.5 s" Tempo tag. One per view. */
		tag?: boolean;
		/** Single-line variant for table cells and rows. */
		compact?: boolean;
		class?: string;
	}

	let {
		txHash,
		finalityMs,
		mode,
		toastTitle,
		toastDescription,
		tag = false,
		compact = false,
		class: className = ''
	}: Props = $props();

	const app = useApp();
	const sim = $derived((mode ?? app.chainMode) === 'sim');
	const shown = $derived(
		!txHash ? '' : txHash.startsWith('sim:') ? txHash : sim ? `sim:${txHash}` : txHash
	);
	const href = $derived(sim ? undefined : (app.txUrl(txHash) ?? undefined));

	onMount(() => {
		if (!toastTitle) return;
		toast.protocol(toastTitle, {
			description: toastDescription,
			txHash: shown,
			href,
			finalityMs
		});
	});
</script>

<div class="result {className}" class:compact>
	{#if finalityMs !== undefined}
		<span class="final tabular"
			><Zap size={13} strokeWidth={1.9} aria-hidden="true" />Final in {formatFinality(
				finalityMs
			)}</span
		>
	{/if}
	{#if shown}
		<Hash value={shown} kind="tx" {href} head={sim ? 10 : 6} size="sm" />
	{/if}
	{#if sim && !compact}<span class="sim">Simulated chain, no explorer link</span>{/if}
	{#if tag}<TempoTag feature="finality" size="sm" />{/if}
</div>

<style>
	.result {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}

	.final {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-weight: var(--weight-medium);
		color: var(--tone-protocol-fg);
	}

	.sim {
		color: var(--color-text-tertiary);
	}

	.compact {
		flex-wrap: nowrap;
	}
</style>
