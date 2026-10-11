<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { IconComponent, Tone } from './status';

	interface Props {
		tone?: Tone;
		size?: 'sm' | 'md';
		/** Solid colored dot before the label. */
		dot?: boolean;
		/** Pulse the dot (live data). */
		pulse?: boolean;
		icon?: IconComponent;
		/** 'soft' tinted fill (default) or 'outline' hairline only. */
		variant?: 'soft' | 'outline';
		mono?: boolean;
		class?: string;
		title?: string;
		children: Snippet;
	}

	let {
		tone = 'neutral',
		size = 'md',
		dot = false,
		pulse = false,
		icon: Icon,
		variant = 'soft',
		mono = false,
		class: className = '',
		title,
		children
	}: Props = $props();
</script>

<span class="badge tone-{tone} {size} {variant} {className}" class:mono {title}>
	{#if dot}<span class="dot" class:pulse aria-hidden="true"></span>{/if}
	{#if Icon}<Icon size={size === 'sm' ? 11 : 12} strokeWidth={2} aria-hidden="true" />{/if}
	<span class="txt">{@render children()}</span>
</span>

<style>
	.badge {
		--fg: var(--tone-neutral-fg);
		--bg: var(--tone-neutral-bg);
		--bd: var(--tone-neutral-border);
		--solid: var(--tone-neutral-solid);
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 1.375rem;
		padding: 0 var(--space-2);
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
		padding: 0 6px;
		font-size: var(--text-2xs);
		gap: 4px;
	}

	.outline {
		background: transparent;
		border-color: var(--color-border);
	}

	.mono .txt {
		font-family: var(--font-mono);
		font-size: 0.95em;
	}

	.dot {
		position: relative;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--solid);
	}

	.dot.pulse::after {
		content: '';
		position: absolute;
		inset: -3px;
		border-radius: 50%;
		background: var(--solid);
		opacity: 0.35;
		animation: pulse 1.8s var(--ease-out) infinite;
	}

	@keyframes pulse {
		0% {
			transform: scale(0.6);
			opacity: 0.45;
		}
		100% {
			transform: scale(1.8);
			opacity: 0;
		}
	}

	.tone-protocol {
		--fg: var(--tone-protocol-fg);
		--bg: var(--tone-protocol-bg);
		--bd: var(--tone-protocol-border);
		--solid: var(--tone-protocol-solid);
	}

	.tone-info {
		--fg: var(--tone-info-fg);
		--bg: var(--tone-info-bg);
		--bd: var(--tone-info-border);
		--solid: var(--tone-info-solid);
	}

	.tone-success {
		--fg: var(--tone-success-fg);
		--bg: var(--tone-success-bg);
		--bd: var(--tone-success-border);
		--solid: var(--tone-success-solid);
	}

	.tone-warning {
		--fg: var(--tone-warning-fg);
		--bg: var(--tone-warning-bg);
		--bd: var(--tone-warning-border);
		--solid: var(--tone-warning-solid);
	}

	.tone-caution {
		--fg: var(--tone-caution-fg);
		--bg: var(--tone-caution-bg);
		--bd: var(--tone-caution-border);
		--solid: var(--tone-caution-solid);
	}

	.tone-danger {
		--fg: var(--tone-danger-fg);
		--bg: var(--tone-danger-bg);
		--bd: var(--tone-danger-border);
		--solid: var(--tone-danger-solid);
	}
</style>
