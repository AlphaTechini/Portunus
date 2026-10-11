<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Info from '@lucide/svelte/icons/info';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import X from '@lucide/svelte/icons/x';
	import { toast, type ToastItem } from './toast.svelte';
	import { formatFinality } from './format';
	import Hash from './Hash.svelte';

	const icons = {
		neutral: Info,
		success: CircleCheck,
		danger: CircleAlert,
		warning: TriangleAlert,
		protocol: ShieldCheck
	} satisfies Record<ToastItem['tone'], unknown>;
</script>

<section class="toaster" aria-label="Notifications">
	<ol>
		{#each toast.items as t (t.id)}
			{@const Icon = icons[t.tone]}
			<li
				class="toast tone-{t.tone}"
				role={t.tone === 'danger' ? 'alert' : 'status'}
				onmouseenter={() => toast.hold(t.id)}
				onmouseleave={() => toast.release(t.id)}
				onfocusin={() => toast.hold(t.id)}
				onfocusout={() => toast.release(t.id)}
			>
				<span class="icon"><Icon size={16} strokeWidth={2} aria-hidden="true" /></span>
				<div class="content">
					<p class="title">{t.title}</p>
					{#if t.description}<p class="desc">{t.description}</p>{/if}
					{#if t.txHash || t.finalityMs !== undefined}
						<div class="meta">
							{#if t.finalityMs !== undefined}
								<span class="final tabular">Final in {formatFinality(t.finalityMs)}</span>
							{/if}
							{#if t.txHash}<Hash value={t.txHash} kind="tx" href={t.href} size="sm" />{/if}
						</div>
					{/if}
					{#if t.action}
						<button
							type="button"
							class="action"
							onclick={() => {
								t.action?.onClick();
								toast.dismiss(t.id);
							}}>{t.action.label}</button
						>
					{/if}
				</div>
				<button
					type="button"
					class="close"
					aria-label="Dismiss notification"
					onclick={() => toast.dismiss(t.id)}
				>
					<X size={14} strokeWidth={1.75} aria-hidden="true" />
				</button>
			</li>
		{/each}
	</ol>
</section>

<style>
	.toaster {
		position: fixed;
		z-index: var(--z-toast);
		/* Top right, under the top bar: clear of drawer and sheet footers (where the primary
		   actions live) and of the demo controls docked at the bottom. */
		top: calc(var(--topbar-height) + var(--space-3));
		right: var(--space-4);
		width: min(24rem, calc(100vw - 2rem));
		pointer-events: none;
	}

	ol {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.toast {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface-raised);
		box-shadow: var(--shadow-lg);
		pointer-events: auto;
		animation: enter var(--duration-slow) var(--ease-out);
	}

	.icon {
		display: inline-flex;
		margin-top: 2px;
		color: var(--color-text-tertiary);
	}

	.tone-success .icon {
		color: var(--tone-success-solid);
	}

	.tone-danger .icon {
		color: var(--tone-danger-solid);
	}

	.tone-warning .icon {
		color: var(--tone-warning-solid);
	}

	.tone-protocol .icon {
		color: var(--tone-protocol-solid);
	}

	.content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.title {
		font-weight: var(--weight-semibold);
		color: var(--color-text);
	}

	.desc {
		color: var(--color-text-secondary);
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-3);
		margin-top: var(--space-1);
	}

	.final {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--tone-protocol-fg);
	}

	.action {
		align-self: flex-start;
		margin-top: var(--space-1-5);
		font-size: var(--text-xs);
		font-weight: var(--weight-semibold);
		color: var(--color-accent-text);
	}

	.action:hover {
		text-decoration: underline;
	}

	.close {
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: var(--radius-sm);
		color: var(--color-text-tertiary);
	}

	.close:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.close:focus-visible,
	.action:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
	}

	@keyframes enter {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
	}

	@media (max-width: 767px) {
		.toaster {
			top: calc(var(--topbar-height) + var(--space-2));
			right: var(--space-3);
			width: calc(100vw - var(--space-6));
		}
	}
</style>
