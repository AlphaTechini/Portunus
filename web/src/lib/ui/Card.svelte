<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Card title (renders a header row). */
		title?: string;
		/** Line under the title. */
		description?: string;
		/** Heading level for the title. Default 2. */
		level?: 2 | 3 | 4;
		/** Right side of the header: buttons, a TempoTag, a status. */
		actions?: Snippet;
		/** Custom header (replaces title/description/actions). */
		header?: Snippet;
		/** Footer row with a top hairline. */
		footer?: Snippet;
		padding?: 'none' | 'sm' | 'md' | 'lg';
		/** 'default' surface; 'sunken' for wells; 'outline' without shadow. */
		variant?: 'default' | 'sunken' | 'outline';
		/** Hover lift for clickable cards. */
		interactive?: boolean;
		element?: 'section' | 'article' | 'div' | 'aside';
		class?: string;
		id?: string;
		children?: Snippet;
	}

	let {
		title,
		description,
		level = 2,
		actions,
		header,
		footer,
		padding = 'md',
		variant = 'default',
		interactive = false,
		element = 'section',
		class: className = '',
		id,
		children
	}: Props = $props();

	const uid = $props.id();
	const titleId = $derived(title ? `card-${uid}-title` : undefined);
</script>

<svelte:element
	this={element}
	{id}
	class="card {variant} pad-{padding} {className}"
	class:interactive
	aria-labelledby={titleId}
>
	{#if header}
		<header class="head">{@render header()}</header>
	{:else if title || actions}
		<header class="head">
			<div class="titles">
				{#if title}
					<svelte:element this={`h${level}`} id={titleId} class="title">{title}</svelte:element>
				{/if}
				{#if description}<p class="desc">{description}</p>{/if}
			</div>
			{#if actions}<div class="actions">{@render actions()}</div>{/if}
		</header>
	{/if}
	{#if children}<div class="body">{@render children()}</div>{/if}
	{#if footer}<footer class="foot">{@render footer()}</footer>{/if}
</svelte:element>

<style>
	.card {
		--pad: var(--space-5);
		display: flex;
		flex-direction: column;
		min-width: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
	}

	.outline {
		box-shadow: none;
	}

	.sunken {
		background: var(--color-surface-sunken);
		border-color: var(--color-border-subtle);
		box-shadow: none;
	}

	.pad-none {
		--pad: 0;
	}

	.pad-sm {
		--pad: var(--space-4);
	}

	.pad-lg {
		--pad: var(--space-6);
	}

	.interactive {
		transition:
			border-color var(--duration-fast) var(--ease-standard),
			box-shadow var(--duration-base) var(--ease-standard);
	}

	.interactive:hover {
		border-color: var(--color-border-strong);
		box-shadow: var(--shadow-md);
	}

	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--pad) var(--pad) 0;
	}

	.pad-none .head {
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.titles {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.title {
		font-size: var(--text-base);
		line-height: var(--leading-base);
		font-weight: var(--weight-semibold);
		letter-spacing: -0.006em;
	}

	.desc {
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	.body {
		padding: var(--pad);
		flex: 1;
		min-width: 0;
	}

	.head + .body {
		padding-top: var(--space-4);
	}

	.pad-none .head + .body {
		padding-top: 0;
	}

	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--pad);
		border-top: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-surface-sunken) 50%, transparent);
		border-radius: 0 0 var(--radius-lg) var(--radius-lg);
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}

	.pad-none .foot {
		padding: var(--space-3) var(--space-5);
	}
</style>
