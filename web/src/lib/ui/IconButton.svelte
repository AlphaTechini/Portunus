<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import type { IconComponent } from './status';
	import Tooltip from './Tooltip.svelte';

	interface Props extends Omit<HTMLButtonAttributes, 'children'> {
		icon: IconComponent;
		/** Required: becomes aria-label and the tooltip text. */
		label: string;
		variant?: 'ghost' | 'secondary';
		size?: 'sm' | 'md' | 'lg';
		tooltip?: boolean;
		pressed?: boolean;
		class?: string;
	}

	let {
		icon: Icon,
		label,
		variant = 'ghost',
		size = 'md',
		tooltip = true,
		pressed,
		class: className = '',
		type = 'button',
		...rest
	}: Props = $props();

	const iconSize = $derived(size === 'sm' ? 14 : size === 'lg' ? 18 : 16);
</script>

{#snippet btn()}
	<button
		{type}
		class="ib {variant} {size} {className}"
		aria-label={label}
		aria-pressed={pressed}
		{...rest}
	>
		<Icon size={iconSize} strokeWidth={1.75} aria-hidden="true" />
	</button>
{/snippet}

{#if tooltip}
	<Tooltip text={label}>{@render btn()}</Tooltip>
{:else}
	{@render btn()}
{/if}

<style>
	.ib {
		--ib: 2.25rem;
		display: inline-grid;
		place-items: center;
		width: var(--ib);
		height: var(--ib);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		transition:
			background-color var(--duration-fast) var(--ease-standard),
			color var(--duration-fast) var(--ease-standard),
			border-color var(--duration-fast) var(--ease-standard);
	}

	.sm {
		--ib: 1.75rem;
		border-radius: var(--radius-sm);
	}

	.lg {
		--ib: 2.75rem;
	}

	.ib:hover:not(:disabled),
	.ib[aria-pressed='true'] {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.secondary {
		background: var(--color-surface);
		border-color: var(--color-border);
		box-shadow: var(--shadow-xs);
	}

	.secondary:hover:not(:disabled) {
		border-color: var(--color-border-strong);
	}

	.ib:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
	}

	.ib:disabled {
		opacity: 0.45;
	}
</style>
