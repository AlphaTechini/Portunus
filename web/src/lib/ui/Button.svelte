<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes, HTMLAnchorAttributes } from 'svelte/elements';
	import type { IconComponent } from './status';
	import Spinner from './Spinner.svelte';

	type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
	type Size = 'sm' | 'md' | 'lg';

	interface Props {
		variant?: Variant;
		size?: Size;
		/** Lucide icon component shown before the label. */
		icon?: IconComponent;
		/** Lucide icon component shown after the label. */
		iconEnd?: IconComponent;
		/** Custom leading content (overrides `icon`). */
		leading?: Snippet;
		loading?: boolean;
		/** Text announced while loading. */
		loadingLabel?: string;
		disabled?: boolean;
		/** Renders an <a> when set. */
		href?: string;
		target?: string;
		rel?: string;
		type?: 'button' | 'submit' | 'reset';
		fullWidth?: boolean;
		class?: string;
		children?: Snippet;
		onclick?: (e: MouseEvent) => void;
		[key: string]: unknown;
	}

	let {
		variant = 'secondary',
		size = 'md',
		icon: Icon,
		iconEnd: IconEnd,
		leading,
		loading = false,
		loadingLabel = 'Working',
		disabled = false,
		href,
		target,
		rel,
		type = 'button',
		fullWidth = false,
		class: className = '',
		children,
		onclick,
		...rest
	}: Props = $props();

	const iconSize = $derived(size === 'sm' ? 14 : size === 'lg' ? 18 : 16);
	const isDisabled = $derived(disabled || loading);
</script>

{#snippet content()}
	{#if loading}
		<span class="lead"><Spinner size={iconSize} /></span>
		<span class="sr-only">{loadingLabel}</span>
	{:else if leading}
		<span class="lead">{@render leading()}</span>
	{:else if Icon}
		<span class="lead"><Icon size={iconSize} strokeWidth={1.75} aria-hidden="true" /></span>
	{/if}
	{#if children}<span class="label">{@render children()}</span>{/if}
	{#if IconEnd && !loading}
		<span class="trail"><IconEnd size={iconSize} strokeWidth={1.75} aria-hidden="true" /></span>
	{/if}
{/snippet}

{#if href && !isDisabled}
	<a
		{href}
		{target}
		rel={rel ?? (target === '_blank' ? 'noreferrer noopener' : undefined)}
		class="btn {variant} {size} {className}"
		class:full={fullWidth}
		{onclick}
		{...rest as HTMLAnchorAttributes}
	>
		{@render content()}
	</a>
{:else}
	<button
		{type}
		class="btn {variant} {size} {className}"
		class:full={fullWidth}
		class:loading
		disabled={isDisabled}
		aria-busy={loading || undefined}
		{onclick}
		{...rest as HTMLButtonAttributes}
	>
		{@render content()}
	</button>
{/if}

<style>
	.btn {
		--btn-h: 2.25rem;
		--btn-px: 0.875rem;
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		height: var(--btn-h);
		padding: 0 var(--btn-px);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		line-height: 1;
		font-weight: var(--weight-medium);
		letter-spacing: -0.003em;
		white-space: nowrap;
		text-decoration: none;
		user-select: none;
		transition:
			background-color var(--duration-fast) var(--ease-standard),
			border-color var(--duration-fast) var(--ease-standard),
			color var(--duration-fast) var(--ease-standard),
			box-shadow var(--duration-fast) var(--ease-standard),
			transform var(--duration-instant) var(--ease-standard);
	}

	.btn:hover {
		text-decoration: none;
	}

	.btn:active:not(:disabled) {
		transform: translateY(0.5px);
	}

	.btn:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
		border-radius: var(--radius-md);
	}

	.btn:disabled {
		opacity: 0.5;
	}

	.btn.loading:disabled {
		opacity: 0.85;
		cursor: progress;
	}

	.full {
		width: 100%;
	}

	.sm {
		--btn-h: 1.875rem;
		--btn-px: var(--space-2-5);
		font-size: var(--text-xs);
		gap: var(--space-1-5);
		border-radius: var(--radius-sm);
	}

	.md {
		--btn-px: 0.875rem;
	}

	.lg {
		--btn-h: 2.75rem;
		--btn-px: var(--space-5);
		font-size: var(--text-base);
	}

	.lead,
	.trail {
		display: inline-flex;
		margin-inline: -0.125rem;
	}

	.lead {
		opacity: 0.92;
	}

	.trail {
		transition: transform var(--duration-fast) var(--ease-out);
	}

	.btn:hover .trail {
		transform: translateX(2px);
	}

	/* primary: ink */
	.primary {
		background: var(--color-primary);
		color: var(--color-primary-fg);
		box-shadow:
			var(--shadow-xs),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}

	.primary:active:not(:disabled) {
		background: var(--color-primary-active);
	}

	/* accent: reserved for the one protocol action on a page (pay, authorize, settle) */
	.accent {
		background: var(--color-accent);
		color: var(--color-accent-fg);
		box-shadow:
			var(--shadow-xs),
			inset 0 1px 0 rgba(255, 255, 255, 0.12);
	}

	.accent:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	.secondary {
		background: var(--color-surface);
		color: var(--color-text);
		border-color: var(--color-border);
		box-shadow: var(--shadow-xs);
	}

	.secondary:hover:not(:disabled) {
		background: var(--color-surface-hover);
		border-color: var(--color-border-strong);
	}

	.ghost {
		background: transparent;
		color: var(--color-text-secondary);
	}

	.ghost:hover:not(:disabled) {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.danger {
		background: var(--color-surface);
		color: var(--tone-danger-fg);
		border-color: var(--tone-danger-border);
		box-shadow: var(--shadow-xs);
	}

	.danger:hover:not(:disabled) {
		background: var(--tone-danger-bg);
	}
</style>
