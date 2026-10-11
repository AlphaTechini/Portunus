<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { IconComponent } from './status';

	interface Props {
		title: string;
		description?: string;
		icon?: IconComponent;
		/** Buttons. */
		actions?: Snippet;
		/** Smaller, for use inside tables and cards. */
		compact?: boolean;
		/** 'error' tints the icon red. */
		tone?: 'default' | 'error';
		class?: string;
	}

	let {
		title,
		description,
		icon: Icon,
		actions,
		compact = false,
		tone = 'default',
		class: className = ''
	}: Props = $props();
</script>

<div class="empty {tone} {className}" class:compact role={tone === 'error' ? 'alert' : undefined}>
	{#if Icon}
		<div class="icon" aria-hidden="true">
			<Icon size={compact ? 18 : 20} strokeWidth={1.5} />
		</div>
	{/if}
	<p class="title">{title}</p>
	{#if description}<p class="desc">{description}</p>{/if}
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-2);
		padding: var(--space-16) var(--space-6);
		max-width: 28rem;
		margin: 0 auto;
	}

	.compact {
		padding: var(--space-10) var(--space-4);
	}

	.icon {
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		margin-bottom: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow:
			var(--shadow-sm),
			0 0 0 6px var(--color-surface-sunken);
		color: var(--color-text-secondary);
	}

	.compact .icon {
		width: 2.25rem;
		height: 2.25rem;
		box-shadow: var(--shadow-xs);
	}

	.error .icon {
		color: var(--tone-danger-fg);
	}

	.title {
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
		color: var(--color-text);
	}

	.desc {
		color: var(--color-text-secondary);
		font-size: var(--text-sm);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
</style>
