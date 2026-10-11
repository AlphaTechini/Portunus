<script lang="ts">
	import type { Snippet } from 'svelte';
	import X from '@lucide/svelte/icons/x';

	interface Props {
		open?: boolean;
		title: string;
		description?: string;
		size?: 'sm' | 'md' | 'lg';
		/** Allow Escape / backdrop click / close button. Set false during a signing step. */
		dismissible?: boolean;
		/** Right-aligned action row. */
		footer?: Snippet;
		/** Content above the title, e.g. a status icon. */
		media?: Snippet;
		onclose?: () => void;
		/** 'modal' centers; 'drawer' slides in from the right. Use <Drawer> for the latter. */
		kind?: 'modal' | 'drawer';
		class?: string;
		children?: Snippet;
	}

	let {
		open = $bindable(false),
		title,
		description,
		size = 'md',
		dismissible = true,
		footer,
		media,
		onclose,
		kind = 'modal',
		class: className = '',
		children
	}: Props = $props();

	const uid = $props.id();
	let dialog: HTMLDialogElement | undefined = $state();
	let restoreFocus: HTMLElement | null = null;

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			restoreFocus = document.activeElement as HTMLElement | null;
			dialog.showModal();
			document.documentElement.style.overflow = 'hidden';
		} else if (!open && dialog.open) {
			dialog.close();
		}
	});

	function handleClose() {
		document.documentElement.style.overflow = '';
		if (open) {
			open = false;
		}
		onclose?.();
		restoreFocus?.focus?.();
	}

	function oncancel(e: Event) {
		if (!dismissible) e.preventDefault();
	}

	function onclick(e: MouseEvent) {
		if (!dismissible || e.target !== dialog) return;
		// click landed on the backdrop area of the dialog element itself
		open = false;
	}
</script>

<dialog
	bind:this={dialog}
	class="dlg {kind} {size} {className}"
	aria-labelledby="dlg-{uid}-title"
	aria-describedby={description ? `dlg-${uid}-desc` : undefined}
	onclose={handleClose}
	{oncancel}
	{onclick}
>
	<div class="panel">
		<header class="head">
			{#if media}<div class="media">{@render media()}</div>{/if}
			<div class="titles">
				<h2 id="dlg-{uid}-title" class="title">{title}</h2>
				{#if description}<p id="dlg-{uid}-desc" class="desc">{description}</p>{/if}
			</div>
			{#if dismissible}
				<button type="button" class="close" aria-label="Close" onclick={() => (open = false)}>
					<X size={16} strokeWidth={1.75} aria-hidden="true" />
				</button>
			{/if}
		</header>
		{#if children}<div class="body">{@render children()}</div>{/if}
		{#if footer}<footer class="foot">{@render footer()}</footer>{/if}
	</div>
</dialog>

<style>
	.dlg {
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--color-text);
		max-width: calc(100vw - 2rem);
		max-height: calc(100dvh - 2rem);
		overflow: visible;
	}

	.dlg::backdrop {
		background: var(--color-overlay);
		animation: fade var(--duration-base) var(--ease-out);
	}

	.panel {
		display: flex;
		flex-direction: column;
		max-height: calc(100dvh - 2rem);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		background: var(--color-surface-raised);
		box-shadow: var(--shadow-overlay);
		overflow: hidden;
	}

	/* modal */
	.modal {
		margin: auto;
		width: 100%;
	}

	.modal.sm {
		max-width: 26rem;
	}

	.modal.md {
		max-width: 34rem;
	}

	.modal.lg {
		max-width: 48rem;
	}

	.modal[open] .panel {
		animation: rise var(--duration-slow) var(--ease-out);
	}

	/* drawer */
	.drawer {
		margin: 0 0 0 auto;
		height: 100dvh;
		max-height: 100dvh;
		width: 100%;
	}

	.drawer.sm {
		max-width: 22rem;
	}

	.drawer.md {
		max-width: 30rem;
	}

	.drawer.lg {
		max-width: 40rem;
	}

	.drawer .panel {
		height: 100dvh;
		max-height: 100dvh;
		border-radius: 0;
		border-width: 0 0 0 1px;
	}

	.drawer[open] .panel {
		animation: slide var(--duration-slow) var(--ease-out);
	}

	.head {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-5) var(--space-6) 0;
	}

	.drawer .head {
		padding-bottom: var(--space-4);
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.media {
		flex-shrink: 0;
	}

	.titles {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.title {
		font-size: var(--text-lg);
		line-height: var(--leading-lg);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-snug);
	}

	.desc {
		color: var(--color-text-secondary);
		font-size: var(--text-sm);
	}

	.close {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		margin: -4px -8px 0 0;
		border-radius: var(--radius-md);
		color: var(--color-text-tertiary);
	}

	.close:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.close:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
	}

	.body {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-5) var(--space-6);
	}

	.foot {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-6);
		border-top: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-surface-sunken) 60%, transparent);
	}

	@keyframes fade {
		from {
			opacity: 0;
		}
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.985);
		}
	}

	@keyframes slide {
		from {
			transform: translateX(24px);
			opacity: 0;
		}
	}

	@media (max-width: 640px) {
		.modal {
			margin: auto 0 0;
			max-width: 100% !important;
			width: 100vw;
			max-height: 92dvh;
		}

		.modal .panel {
			border-radius: var(--radius-xl) var(--radius-xl) 0 0;
			max-height: 92dvh;
		}
	}
</style>
