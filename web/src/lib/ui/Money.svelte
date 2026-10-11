<script lang="ts">
	import { formatMoney, moneyParts, type AmountInput } from './format';

	interface Props {
		amount: AmountInput;
		/** For bigint base units. Default 6 (TIP-20 stablecoins). */
		decimals?: number;
		/** Token symbol shown after the amount, e.g. "pathUSD". Omit for plain "$". */
		unit?: string;
		size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'display';
		/** Color by meaning: credit to the viewer, debit, or muted. */
		tone?: 'default' | 'muted' | 'positive' | 'negative' | 'protocol';
		/** Show + on positive values. */
		signed?: boolean;
		/** Render cents lighter (KPIs, hero figures). */
		dimCents?: boolean;
		/** Compact notation ($1.2M). KPI tiles only. */
		compact?: boolean;
		class?: string;
	}

	let {
		amount,
		decimals,
		unit,
		size = 'md',
		tone = 'default',
		signed = false,
		dimCents = false,
		compact = false,
		class: className = ''
	}: Props = $props();

	const full = $derived(formatMoney(amount, { decimals, signed, compact }));
	const parts = $derived(moneyParts(amount, { decimals, signed }));
</script>

<span class="money {size} tone-{tone} {className}" title={unit ? `${full} ${unit}` : undefined}>
	{#if dimCents && !compact}
		<span class="sr-only">{full}{unit ? ` ${unit}` : ''}</span>
		<span aria-hidden="true"
			>{parts.sign}{parts.symbol}{parts.whole}<span class="cents">.{parts.fraction}</span></span
		>
	{:else}
		{full}
	{/if}
	{#if unit}<span class="unit" aria-hidden={dimCents ? 'true' : undefined}>{unit}</span>{/if}
</span>

<style>
	.money {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3em;
		font-variant-numeric: tabular-nums;
		font-feature-settings: var(--font-features-numeric);
		white-space: nowrap;
		color: var(--color-text);
	}

	.xs {
		font-size: var(--text-xs);
	}

	.sm {
		font-size: var(--text-sm);
	}

	.md {
		font-size: inherit;
		font-weight: var(--weight-medium);
	}

	.lg {
		font-size: var(--text-xl);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-snug);
	}

	.xl {
		font-size: var(--text-3xl);
		line-height: var(--leading-3xl);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tight);
	}

	.display {
		font-size: var(--text-5xl);
		line-height: 1;
		font-weight: var(--weight-semibold);
		letter-spacing: -0.035em;
	}

	.cents {
		color: var(--color-text-tertiary);
		font-weight: inherit;
	}

	.unit {
		font-size: 0.72em;
		font-weight: var(--weight-medium);
		letter-spacing: 0;
		color: var(--color-text-tertiary);
	}

	.tone-muted {
		color: var(--color-text-secondary);
	}

	.tone-positive {
		color: var(--tone-success-fg);
	}

	.tone-negative {
		color: var(--tone-danger-fg);
	}

	.tone-protocol {
		color: var(--tone-protocol-fg);
	}
</style>
