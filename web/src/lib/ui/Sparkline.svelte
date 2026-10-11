<script lang="ts">
	interface Props {
		values: number[];
		width?: number;
		height?: number;
		/** Fill the area under the line. */
		area?: boolean;
		/** Accessible summary, e.g. "Deposits held over 14 days, rising". */
		label?: string;
		tone?: 'accent' | 'neutral';
	}

	let { values, width = 96, height = 28, area = true, label, tone = 'accent' }: Props = $props();

	const uid = $props.id();

	const pts = $derived.by(() => {
		if (values.length < 2) return [] as [number, number][];
		const min = Math.min(...values);
		const max = Math.max(...values);
		const span = max - min || 1;
		const pad = 2;
		return values.map((v, i) => [
			(i / (values.length - 1)) * width,
			pad + (1 - (v - min) / span) * (height - pad * 2)
		]) as [number, number][];
	});

	const line = $derived(
		pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
	);
	const fill = $derived(pts.length ? `${line}L${width},${height}L0,${height}Z` : '');
	const last = $derived(pts.at(-1));
</script>

<svg
	class="spark {tone}"
	viewBox="0 0 {width} {height}"
	{width}
	{height}
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	preserveAspectRatio="none"
>
	<defs>
		<linearGradient id="sg-{uid}" x1="0" x2="0" y1="0" y2="1">
			<stop offset="0" stop-color="currentColor" stop-opacity="0.16" />
			<stop offset="1" stop-color="currentColor" stop-opacity="0" />
		</linearGradient>
	</defs>
	{#if area && fill}<path d={fill} fill="url(#sg-{uid})" />{/if}
	{#if line}
		<path
			d={line}
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linejoin="round"
			stroke-linecap="round"
			vector-effect="non-scaling-stroke"
		/>
	{/if}
	{#if last}<circle cx={last[0] - 1.5} cy={last[1]} r="2" fill="currentColor" />{/if}
</svg>

<style>
	.spark {
		overflow: visible;
	}

	.accent {
		color: var(--color-accent);
	}

	.neutral {
		color: var(--color-text-tertiary);
	}
</style>
