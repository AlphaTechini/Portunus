<script lang="ts">
	import type { Snippet } from 'svelte';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import ArrowDownRight from '@lucide/svelte/icons/arrow-down-right';
	import type { IconComponent } from './status';
	import Sparkline from './Sparkline.svelte';
	import Skeleton from './Skeleton.svelte';

	interface Delta {
		/** Display text, e.g. "+12%" or "-2.1 days". */
		value: string;
		direction: 'up' | 'down' | 'flat';
		/** Whether this direction is good news. Colors follow meaning, not direction. */
		sentiment?: 'positive' | 'negative' | 'neutral';
		/** "vs last month" */
		context?: string;
	}

	interface Props {
		label: string;
		/** Pre-formatted value string (use formatMoney etc.). */
		value?: string;
		/** Custom value rendering (e.g. <Money>). */
		valueSnippet?: Snippet;
		/** Small unit after the value: "days", "containers". */
		unit?: string;
		delta?: Delta;
		/** One line under the value. */
		hint?: string;
		/** Footer content, e.g. a TempoTag naming the data source. */
		footer?: Snippet;
		icon?: IconComponent;
		sparkline?: number[];
		sparklineLabel?: string;
		loading?: boolean;
		/** Card chrome; set false inside a grouped StatGroup-like card. */
		framed?: boolean;
		href?: string;
		class?: string;
	}

	let {
		label,
		value,
		valueSnippet,
		unit,
		delta,
		hint,
		footer,
		icon: Icon,
		sparkline,
		sparklineLabel,
		loading = false,
		framed = true,
		href,
		class: className = ''
	}: Props = $props();

	const sentimentClass = $derived(delta?.sentiment ?? 'neutral');
</script>

<svelte:element
	this={href ? 'a' : 'div'}
	{href}
	class="stat {className}"
	class:framed
	class:link={!!href}
>
	<div class="top">
		<span class="label">
			{#if Icon}<Icon size={14} strokeWidth={1.75} aria-hidden="true" />{/if}
			{label}
		</span>
	</div>
	<div class="value-row">
		{#if loading}
			<Skeleton width="7rem" height="2rem" />
		{:else}
			<span class="value tabular">
				{#if valueSnippet}{@render valueSnippet()}{:else}{value}{/if}
			</span>
			{#if unit}<span class="unit">{unit}</span>{/if}
			{#if sparkline}
				<span class="spark"><Sparkline values={sparkline} label={sparklineLabel} /></span>
			{/if}
		{/if}
	</div>
	{#if (delta || hint) && !loading}
		<div class="meta">
			{#if delta}
				<span class="delta {sentimentClass}">
					{#if delta.direction === 'up'}<ArrowUpRight
							size={13}
							strokeWidth={2}
							aria-hidden="true"
						/>{/if}
					{#if delta.direction === 'down'}<ArrowDownRight
							size={13}
							strokeWidth={2}
							aria-hidden="true"
						/>{/if}
					<span class="tabular">{delta.value}</span>
				</span>
				{#if delta.context}<span class="ctx">{delta.context}</span>{/if}
			{/if}
			{#if hint}<span class="ctx">{hint}</span>{/if}
		</div>
	{/if}
	{#if footer}<span class="push" aria-hidden="true"></span>
		<div class="foot">{@render footer()}</div>{/if}
</svelte:element>

<style>
	.stat {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		color: inherit;
		text-decoration: none;
	}

	.framed {
		/* tiles in a KPI row share one height; the footer sits on the bottom edge */
		height: 100%;
		padding: var(--space-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
	}

	.link {
		transition:
			border-color var(--duration-fast) var(--ease-standard),
			box-shadow var(--duration-base) var(--ease-standard);
	}

	.link:hover {
		text-decoration: none;
		border-color: var(--color-border-strong);
		box-shadow: var(--shadow-md);
	}

	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		min-height: 1.25rem;
	}

	.spark {
		margin-left: auto;
		align-self: flex-end;
		padding-bottom: 4px;
	}

	.label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1-5);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text-secondary);
	}

	.label :global(svg) {
		color: var(--color-text-tertiary);
	}

	.value-row {
		display: flex;
		align-items: baseline;
		gap: var(--space-1-5);
		min-height: 2.25rem;
	}

	.value {
		font-size: var(--text-3xl);
		line-height: var(--leading-3xl);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tight);
		color: var(--color-text);
		white-space: nowrap;
	}

	.unit {
		font-size: var(--text-sm);
		color: var(--color-text-tertiary);
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1-5) var(--space-2);
		font-size: var(--text-xs);
	}

	.delta {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		font-weight: var(--weight-medium);
	}

	.delta.positive {
		color: var(--tone-success-fg);
	}

	.delta.negative {
		color: var(--tone-danger-fg);
	}

	.delta.neutral {
		color: var(--color-text-secondary);
	}

	.ctx {
		color: var(--color-text-tertiary);
	}

	@media (max-width: 767px) {
		.framed {
			padding: var(--space-4);
		}

		.value {
			font-size: var(--text-2xl);
			line-height: var(--leading-2xl);
		}

		.value-row {
			min-height: 0;
		}
	}

	.push {
		flex: 1;
	}

	.foot {
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-border-subtle);
	}
</style>
