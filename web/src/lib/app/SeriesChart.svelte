<script lang="ts">
	/**
	 * One-series chart for the dashboards: an area line (running totals, e.g. cash held) or bars
	 * (per-bucket sums, e.g. refunds per day). Hover or focus shows a crosshair and a tooltip,
	 * arrow keys step through the points. Values are USD numbers.
	 */
	import { formatDate, formatMoney } from '#lib/ui';

	interface Point {
		t: number;
		value: number;
	}
	interface Props {
		points: Point[];
		kind?: 'area' | 'bars';
		/** Accessible name, e.g. "Cash held per day, last 30 days". */
		label: string;
		height?: number;
	}
	let { points, kind = 'area', label, height = 132 }: Props = $props();

	let width = $state(0);
	let active = $state<number | null>(null);
	const padX = 4;
	const padTop = 10;
	const padBottom = 22;

	const max = $derived(Math.max(1, ...points.map((p) => p.value)));
	const innerW = $derived(Math.max(0, width - padX * 2));
	const innerH = $derived(height - padTop - padBottom);
	const slot = $derived(points.length > 0 ? innerW / points.length : 0);
	const xAt = (i: number) =>
		kind === 'bars'
			? padX + slot * i + slot / 2
			: padX + (points.length > 1 ? (innerW * i) / (points.length - 1) : innerW / 2);
	const yAt = (v: number) => padTop + innerH - (v / max) * innerH;

	const linePath = $derived(
		points
			.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)} ${yAt(p.value).toFixed(1)}`)
			.join(' ')
	);
	const areaPath = $derived(
		points.length
			? `${linePath} L${xAt(points.length - 1).toFixed(1)} ${padTop + innerH} L${xAt(0).toFixed(1)} ${padTop + innerH} Z`
			: ''
	);
	const barW = $derived(Math.max(2, Math.min(14, slot - 2)));

	function pick(e: PointerEvent) {
		const r = (e.currentTarget as SVGElement).getBoundingClientRect();
		const x = e.clientX - r.left - padX;
		const i =
			kind === 'bars' ? Math.floor(x / slot) : Math.round((x / innerW) * (points.length - 1));
		active = Math.min(points.length - 1, Math.max(0, i));
	}
	function key(e: KeyboardEvent) {
		if (!points.length) return;
		if (e.key === 'ArrowRight') active = Math.min(points.length - 1, (active ?? -1) + 1);
		else if (e.key === 'ArrowLeft') active = Math.max(0, (active ?? points.length) - 1);
		else if (e.key === 'Escape') active = null;
		else return;
		e.preventDefault();
	}

	const tip = $derived(active !== null ? points[active] : null);
	const tipLeft = $derived(active !== null ? Math.min(Math.max(xAt(active), 56), width - 56) : 0);
	const summary = $derived(
		points.length
			? `${label}. Latest ${formatMoney(points[points.length - 1].value)}, highest ${formatMoney(max)}.`
			: label
	);
</script>

<div class="chart" bind:clientWidth={width} style:height="{height}px">
	{#if width > 0 && points.length}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
		<svg
			{width}
			{height}
			role="img"
			aria-label={summary}
			tabindex="0"
			onpointermove={pick}
			onpointerleave={() => (active = null)}
			onkeydown={key}
			onblur={() => (active = null)}
		>
			{#each [0, 0.5, 1] as g (g)}
				<line class="grid" x1={padX} x2={width - padX} y1={yAt(max * g)} y2={yAt(max * g)} />
			{/each}
			{#if kind === 'area'}
				<path class="area" d={areaPath} />
				<path class="line" d={linePath} />
			{:else}
				{#each points as p, i (p.t)}
					{@const h = Math.max(p.value > 0 ? 3 : 0, (p.value / max) * innerH)}
					<rect
						class="bar"
						class:on={active === i}
						x={xAt(i) - barW / 2}
						y={padTop + innerH - h}
						width={barW}
						height={h}
						rx="2"
					/>
				{/each}
			{/if}
			<line class="base" x1={padX} x2={width - padX} y1={padTop + innerH} y2={padTop + innerH} />
			<text class="axis" x={padX} y={height - 6}>{formatDate(points[0].t)}</text>
			<text class="axis" x={width - padX} y={height - 6} text-anchor="end"
				>{formatDate(points[points.length - 1].t)}</text
			>
			{#if active !== null && tip}
				<line class="cross" x1={xAt(active)} x2={xAt(active)} y1={padTop} y2={padTop + innerH} />
				{#if kind === 'area'}
					<circle class="dot" cx={xAt(active)} cy={yAt(tip.value)} r="4" />
				{/if}
			{/if}
		</svg>
		{#if tip}
			<div class="tip" style:left="{tipLeft}px" aria-hidden="true">
				<span class="tip-d">{formatDate(tip.t)}</span>
				<span class="tip-v tabular">{formatMoney(tip.value)}</span>
			</div>
		{/if}
	{/if}
</div>

<style>
	.chart {
		position: relative;
		width: 100%;
	}
	svg {
		display: block;
		overflow: visible;
		border-radius: var(--radius-md);
		outline: none;
		touch-action: pan-y;
	}
	svg:focus-visible {
		box-shadow: var(--color-focus-ring);
	}
	.grid {
		stroke: var(--color-border-subtle);
		stroke-width: 1;
		stroke-dasharray: 2 4;
	}
	.base {
		stroke: var(--color-border);
		stroke-width: 1;
	}
	.line {
		fill: none;
		stroke: var(--color-accent);
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.area {
		fill: var(--color-accent-subtle);
	}
	.bar {
		fill: var(--color-accent);
		opacity: 0.85;
	}
	.bar.on {
		opacity: 1;
	}
	.cross {
		stroke: var(--color-border-strong);
		stroke-width: 1;
	}
	.dot {
		fill: var(--color-accent);
		stroke: var(--color-surface);
		stroke-width: 2;
	}
	.axis {
		fill: var(--color-text-tertiary);
		font-size: var(--text-2xs);
		font-family: var(--font-sans);
	}
	.tip {
		position: absolute;
		top: 0;
		transform: translate(-50%, -4px);
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface-raised);
		box-shadow: var(--shadow-md);
		pointer-events: none;
		white-space: nowrap;
		font-size: var(--text-xs);
	}
	.tip-d {
		color: var(--color-text-tertiary);
	}
	.tip-v {
		font-weight: var(--weight-semibold);
		color: var(--color-text);
	}
</style>
