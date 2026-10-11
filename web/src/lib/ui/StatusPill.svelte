<script lang="ts">
	import { statusOf, type ContainerState } from './status';

	interface Props {
		state: ContainerState;
		/** Use the sentence label ("Deposit held by protocol"). */
		long?: boolean;
		/** Override the label text (e.g. "Authorized: up to $150.00 per day"). */
		label?: string;
		size?: 'sm' | 'md' | 'lg';
		/** Show the description as a native title tooltip. Default true. */
		describe?: boolean;
		class?: string;
	}

	let {
		state,
		long = false,
		label,
		size = 'md',
		describe = true,
		class: className = ''
	}: Props = $props();

	const def = $derived(statusOf(state));
	const text = $derived(label ?? (long ? def.long : def.label));
	const iconSize = $derived(size === 'sm' ? 11 : size === 'lg' ? 15 : 12);
</script>

<span
	class="pill tone-{def.tone} {size} {className}"
	class:live={def.live}
	class:spin={state === 'pending_onchain' || state === 'settling'}
	title={describe ? def.description : undefined}
	data-state={state}
>
	<def.icon size={iconSize} strokeWidth={2} aria-hidden="true" />
	<span>{text}</span>
</span>

<style>
	.pill {
		--fg: var(--tone-neutral-fg);
		--bg: var(--tone-neutral-bg);
		--bd: var(--tone-neutral-border);
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 1.375rem;
		padding: 0 var(--space-2) 0 7px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-full);
		background: var(--bg);
		color: var(--fg);
		font-size: var(--text-xs);
		line-height: 1;
		font-weight: var(--weight-medium);
		white-space: nowrap;
		vertical-align: middle;
	}

	.sm {
		height: 1.125rem;
		padding: 0 6px 0 5px;
		gap: 4px;
		font-size: var(--text-2xs);
	}

	.lg {
		height: 1.75rem;
		padding: 0 var(--space-3) 0 var(--space-2-5);
		gap: 6px;
		font-size: var(--text-sm);
	}

	.spin :global(svg) {
		animation: spin 1.4s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.tone-protocol {
		--fg: var(--tone-protocol-fg);
		--bg: var(--tone-protocol-bg);
		--bd: var(--tone-protocol-border);
	}

	.tone-info {
		--fg: var(--tone-info-fg);
		--bg: var(--tone-info-bg);
		--bd: var(--tone-info-border);
	}

	.tone-success {
		--fg: var(--tone-success-fg);
		--bg: var(--tone-success-bg);
		--bd: var(--tone-success-border);
	}

	.tone-warning {
		--fg: var(--tone-warning-fg);
		--bg: var(--tone-warning-bg);
		--bd: var(--tone-warning-border);
	}

	.tone-caution {
		--fg: var(--tone-caution-fg);
		--bg: var(--tone-caution-bg);
		--bd: var(--tone-caution-border);
	}

	.tone-danger {
		--fg: var(--tone-danger-fg);
		--bg: var(--tone-danger-bg);
		--bd: var(--tone-danger-border);
	}
</style>
