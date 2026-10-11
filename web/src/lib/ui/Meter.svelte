<script lang="ts">
	import { formatMoney, formatPercent, type AmountInput, toUsd } from './format';

	interface Props {
		/** Detention accrued so far (USD number, or bigint base units). */
		value: AmountInput;
		/** The deposit (held mode) or maximum pull (deposit-free mode). */
		max: AmountInput;
		/** Daily detention rate: draws a tick per day and the "covers N more days" hint. */
		dailyRate?: AmountInput;
		decimals?: number;
		label?: string;
		/** What max is called: "deposit" or "maximum". */
		maxLabel?: string;
		/** Accrual is running right now (animated leading edge). */
		live?: boolean;
		size?: 'sm' | 'md';
		/** Hide the footer line. */
		compact?: boolean;
		class?: string;
	}

	let {
		value,
		max,
		dailyRate,
		decimals,
		label = 'Detention accrued',
		maxLabel = 'deposit',
		live = false,
		size = 'md',
		compact = false,
		class: className = ''
	}: Props = $props();

	const v = $derived(toUsd(value, decimals));
	const m = $derived(toUsd(max, decimals));
	const rate = $derived(dailyRate !== undefined ? toUsd(dailyRate, decimals) : undefined);
	const ratio = $derived(m > 0 ? Math.min(1, Math.max(0, v / m)) : 0);
	const tone = $derived(ratio >= 1 ? 'danger' : ratio >= 0.75 ? 'caution' : 'protocol');
	const days = $derived(rate ? Math.round(v / rate) : undefined);
	const ticks = $derived(rate && m / rate <= 40 ? Math.floor(m / rate) : 0);
	const remainingDays = $derived(rate ? Math.max(0, Math.floor((m - v) / rate)) : undefined);
</script>

<div class="meter {size} tone-{tone} {className}">
	<div class="head">
		<span class="label">{label}</span>
		<span class="figures tabular">
			<strong>{formatMoney(v)}</strong>
			<span class="of">of {formatMoney(m)} {maxLabel}</span>
		</span>
	</div>
	<div
		class="track"
		role="meter"
		aria-label={label}
		aria-valuemin={0}
		aria-valuemax={m}
		aria-valuenow={Math.min(v, m)}
		aria-valuetext="{formatMoney(v)} of {formatMoney(m)} {maxLabel}, {formatPercent(ratio)}"
	>
		<div class="fill" class:live style:width="{ratio * 100}%"></div>
		{#if ticks > 1}
			{#each Array.from({ length: ticks - 1 }, (_, i) => i + 1) as t (t)}
				<span class="tick" style:left="{((t * (rate ?? 0)) / m) * 100}%"></span>
			{/each}
		{/if}
	</div>
	{#if !compact}
		<div class="foot tabular">
			<span>
				{#if days !== undefined && rate !== undefined}
					{days} {days === 1 ? 'day' : 'days'} at {formatMoney(rate)} per day
				{:else}
					{formatPercent(ratio)} of {maxLabel}
				{/if}
			</span>
			<span>
				{#if ratio >= 1}
					{maxLabel[0].toUpperCase() + maxLabel.slice(1)} fully used
				{:else if remainingDays !== undefined}
					{formatPercent(ratio)} used, covers {remainingDays} more {remainingDays === 1
						? 'day'
						: 'days'}
				{:else}
					{formatMoney(m - v)} left
				{/if}
			</span>
		</div>
	{/if}
</div>

<style>
	.meter {
		--solid: var(--tone-protocol-solid);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.tone-caution {
		--solid: var(--tone-caution-solid);
	}

	.tone-danger {
		--solid: var(--tone-danger-solid);
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-1) var(--space-3);
	}

	.label {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text-secondary);
	}

	.figures {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 var(--space-1-5);
	}

	.figures strong {
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
		color: var(--color-text);
	}

	.md .figures strong {
		font-size: var(--text-lg);
	}

	.of {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
		/* "of $1,200.00 deposit" wraps as one phrase, never word by word */
		white-space: nowrap;
	}

	.track {
		position: relative;
		height: 8px;
		border-radius: var(--radius-full);
		background: var(--color-surface-active);
		overflow: hidden;
	}

	.sm .track {
		height: 6px;
	}

	.fill {
		position: relative;
		height: 100%;
		border-radius: inherit;
		background: var(--solid);
		transition: width var(--duration-slower) var(--ease-out);
	}

	.fill.live::after {
		content: '';
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		width: 24px;
		background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55));
		animation: glint 1.8s var(--ease-in-out) infinite;
	}

	@keyframes glint {
		0%,
		100% {
			opacity: 0.1;
		}
		50% {
			opacity: 1;
		}
	}

	.tick {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		margin-left: -1px;
		background: var(--color-surface);
		opacity: 0.9;
	}

	.foot {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--space-1) var(--space-3);
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}
</style>
