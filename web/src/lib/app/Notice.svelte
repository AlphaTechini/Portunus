<script lang="ts">
	/**
	 * Inline notice for a card or panel: warnings (partial coverage), errors (action failed),
	 * confirmations. Tones come from the design system's tone tokens.
	 */
	import type { Snippet } from 'svelte';
	import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import Info from '@lucide/svelte/icons/info';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import type { IconComponent, Tone } from '#lib/ui';

	interface Props {
		tone?: Exclude<Tone, 'neutral'>;
		title?: string;
		icon?: IconComponent;
		/** Right side: a button or link. */
		actions?: Snippet;
		children?: Snippet;
		class?: string;
		[key: string]: unknown;
	}
	let {
		tone = 'info',
		title,
		icon,
		actions,
		children,
		class: className = '',
		...rest
	}: Props = $props();

	const Icon = $derived(
		icon ??
			(tone === 'danger'
				? CircleX
				: tone === 'warning' || tone === 'caution'
					? AlertTriangle
					: tone === 'success'
						? CircleCheck
						: tone === 'protocol'
							? ShieldCheck
							: Info)
	);
</script>

<div class="notice tone-{tone} {className}" role={tone === 'danger' ? 'alert' : 'status'} {...rest}>
	<span class="icon" aria-hidden="true"><Icon size={16} strokeWidth={1.9} /></span>
	<div class="text">
		{#if title}<p class="title">{title}</p>{/if}
		{#if children}<div class="body">{@render children()}</div>{/if}
	</div>
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
	.notice {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--notice-border);
		border-radius: var(--radius-md);
		background: var(--notice-bg);
		color: var(--color-text);
		font-size: var(--text-sm);
	}
	.tone-info {
		--notice-bg: var(--tone-info-bg);
		--notice-border: var(--tone-info-border);
		--notice-fg: var(--tone-info-fg);
	}
	.tone-protocol {
		--notice-bg: var(--tone-protocol-bg);
		--notice-border: var(--tone-protocol-border);
		--notice-fg: var(--tone-protocol-fg);
	}
	.tone-success {
		--notice-bg: var(--tone-success-bg);
		--notice-border: var(--tone-success-border);
		--notice-fg: var(--tone-success-fg);
	}
	.tone-warning {
		--notice-bg: var(--tone-warning-bg);
		--notice-border: var(--tone-warning-border);
		--notice-fg: var(--tone-warning-fg);
	}
	.tone-caution {
		--notice-bg: var(--tone-caution-bg);
		--notice-border: var(--tone-caution-border);
		--notice-fg: var(--tone-caution-fg);
	}
	.tone-danger {
		--notice-bg: var(--tone-danger-bg);
		--notice-border: var(--tone-danger-border);
		--notice-fg: var(--tone-danger-fg);
	}
	.icon {
		display: inline-flex;
		margin-top: 1px;
		color: var(--notice-fg);
		flex-shrink: 0;
	}
	.text {
		flex: 1;
		min-width: 0;
	}
	.title {
		margin: 0;
		font-weight: var(--weight-semibold);
		color: var(--notice-fg);
	}
	.body {
		margin-top: var(--space-0-5);
		color: var(--color-text);
		line-height: var(--leading-sm);
	}
	.title + .body {
		margin-top: var(--space-1);
	}
	.body :global(p) {
		margin: 0;
	}
	.actions {
		flex-shrink: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	@media (max-width: 560px) {
		.notice {
			flex-wrap: wrap;
		}
		.actions {
			width: 100%;
		}
	}
</style>
