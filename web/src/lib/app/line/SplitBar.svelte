<script lang="ts">
	/** Two-segment bar: what goes to the line and what goes back to the importer. */
	interface Props {
		toLine: number;
		toImporter: number;
		lineLabel: string;
		importerLabel: string;
	}
	let { toLine, toImporter, lineLabel, importerLabel }: Props = $props();
	const total = $derived(toLine + toImporter);
	const linePct = $derived(total > 0 ? (toLine / total) * 100 : 0);
</script>

<div
	class="split"
	role="img"
	aria-label="{lineLabel} {Math.round(linePct)}%, {importerLabel} {Math.round(100 - linePct)}%"
>
	{#if total > 0}
		<div class="seg line" style:width="{linePct}%"></div>
		<div class="seg importer" style:width="{100 - linePct}%"></div>
	{/if}
</div>

<style>
	.split {
		display: flex;
		height: 8px;
		gap: 2px;
		border-radius: var(--radius-full);
		background: var(--color-surface-active);
		overflow: hidden;
	}

	.seg {
		height: 100%;
		min-width: 0;
		transition: width var(--duration-slower) var(--ease-out);
	}

	.line {
		background: var(--tone-caution-solid);
	}

	.importer {
		background: var(--tone-success-solid);
	}
</style>
