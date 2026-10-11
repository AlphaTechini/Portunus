<script lang="ts">
	/**
	 * Minimal area chart for a daily series (the dashboard's 30 days). Hairline guides, an end dot,
	 * the first and last dates and the range in text; the summary is exposed to screen readers.
	 * Values are USD numbers.
	 */
	import { formatDate, formatMoney } from '#lib/ui';

	interface Point {
		t: number;
		value: number;
	}
	interface Props {
		points: Point[];
		/** Accessible name, e.g. "Deposits held over 30 days". */
		label: string;
		height?: number;
	}
	let { points, label, height = 132 }: Props = $props();

	const W = 600;
	const uid = $props.id();

	const stats = $derived.by(() => {
		const vals = points.map((p) => p.value);
		const min = vals.length ? Math.min(...vals) : 0;
		const max = vals.length ? Math.max(...vals) : 0;
		return { min, max, last: vals.at(-1) ?? 0, first: vals[0] ?? 0 };
	});
	const lo = $derived(Math.min(0, stats.min));
	const hi = $derived(stats.max > lo ? stats.max : lo + 1);
	const xy = $derived(
		points.map((p, i) => ({
			x: points.length > 1 ? (i / (points.length - 1)) * W : W,
			y: 6 + (1 - (p.value - lo) / (hi - lo)) * (height - 12)
		}))
	);
	const line = $derived(
		xy.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('')
	);
	const area = $derived(xy.length ? `${line}L${W},${height}L0,${height}Z` : '');
	const end = $derived(xy.at(-1));
	const summary = $derived(
		points.length
			? `${label}: from ${formatMoney(stats.first)} to ${formatMoney(stats.last)}, highest ${formatMoney(stats.max)}.`
			: `${label}: no data yet.`
	);
</script>

<figure class="chart">
	<div class="plot" style:height="{height}px">
		<svg
			viewBox="0 0 {W} {height}"
			preserveAspectRatio="none"
			role="img"
			aria-label={summary}
			width="100%"
			{height}
		>
			<defs>
				<linearGradient id="area-{uid}" x1="0" x2="0" y1="0" y2="1">
					<stop offset="0" stop-color="currentColor" stop-opacity="0.18" />
					<stop offset="1" stop-color="currentColor" stop-opacity="0" />
				</linearGradient>
			</defs>
			{#each [0.25, 0.5, 0.75] as g (g)}
				<line
					x1="0"
					x2={W}
					y1={height * g}
					y2={height * g}
					class="guide"
					vector-effect="non-scaling-stroke"
				/>
			{/each}
			{#if area}<path d={area} fill="url(#area-{uid})" />{/if}
			{#if line}
				<path
					d={line}
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linejoin="round"
					stroke-linecap="round"
					vector-effect="non-scaling-stroke"
				/>
			{/if}
		</svg>
		{#if end}
			<span class="dot" style:left="{(end.x / W) * 100}%" style:top="{end.y}px" aria-hidden="true"
			></span>
		{/if}
	</div>
	<figcaption class="axis tabular">
		<span>{points.length ? formatDate(points[0].t) : ''}</span>
		<span class="range">Low {formatMoney(stats.min)} · High {formatMoney(stats.max)}</span>
		<span>{points.length ? formatDate(points.at(-1)!.t) : ''}</span>
	</figcaption>
</figure>

<style>
	.chart {
		margin: 0;
		color: var(--color-accent);
	}

	.plot {
		position: relative;
		width: 100%;
	}

	svg {
		display: block;
		width: 100%;
		overflow: visible;
	}

	.guide {
		stroke: var(--color-border-subtle);
		stroke-width: 1;
	}

	.dot {
		position: absolute;
		width: 9px;
		height: 9px;
		margin: -4.5px 0 0 -6px;
		border-radius: var(--radius-full);
		background: currentColor;
		box-shadow: 0 0 0 3px var(--color-surface);
	}

	.axis {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		margin-top: var(--space-2);
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.range {
		text-align: center;
	}

	@media (max-width: 520px) {
		.range {
			display: none;
		}
	}
</style>
