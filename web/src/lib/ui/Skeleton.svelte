<script lang="ts">
	interface Props {
		width?: string;
		height?: string;
		radius?: string;
		/** Render N text lines (last one shorter). */
		lines?: number;
		circle?: boolean;
		class?: string;
	}

	let {
		width = '100%',
		height = '0.875rem',
		radius = 'var(--radius-sm)',
		lines,
		circle = false,
		class: className = ''
	}: Props = $props();
</script>

{#if lines && lines > 1}
	<span class="stack {className}" aria-hidden="true">
		{#each Array.from({ length: lines }, (_, i) => i) as i (i)}
			<span
				class="sk"
				style:width={i === lines - 1 ? '62%' : width}
				style:height
				style:border-radius={radius}
			></span>
		{/each}
	</span>
{:else}
	<span
		class="sk {className}"
		aria-hidden="true"
		style:width={circle ? height : width}
		style:height
		style:border-radius={circle ? '50%' : radius}
	></span>
{/if}

<style>
	.stack {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		width: 100%;
	}

	.sk {
		display: inline-block;
		vertical-align: middle;
		max-width: 100%;
		background: linear-gradient(
			90deg,
			var(--color-skeleton) 0%,
			var(--color-skeleton-shine) 40%,
			var(--color-skeleton) 80%
		);
		background-size: 300% 100%;
		animation: shimmer 1.6s var(--ease-in-out) infinite;
	}

	@keyframes shimmer {
		from {
			background-position: 100% 0;
		}
		to {
			background-position: -50% 0;
		}
	}
</style>
