<script lang="ts">
	/** Thin progress bar: how much of the required deposit has arrived. */
	interface Props {
		value: number;
		max: number;
		label: string;
	}
	let { value, max, label }: Props = $props();
	const ratio = $derived(max > 0 ? Math.min(1, Math.max(0, value / max)) : 0);
</script>

<div
	class="bar"
	role="meter"
	aria-label={label}
	aria-valuemin={0}
	aria-valuemax={max}
	aria-valuenow={Math.min(value, max)}
>
	<div class="fill" class:full={ratio >= 1} style:width="{ratio * 100}%"></div>
</div>

<style>
	.bar {
		height: 6px;
		border-radius: var(--radius-full);
		background: var(--color-surface-active);
		overflow: hidden;
	}

	.fill {
		height: 100%;
		border-radius: inherit;
		background: var(--tone-warning-solid);
		transition: width var(--duration-slower) var(--ease-out);
	}

	.fill.full {
		background: var(--tone-protocol-solid);
	}
</style>
