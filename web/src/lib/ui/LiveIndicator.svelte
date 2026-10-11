<script lang="ts">
	import type { LiveState } from './types';

	interface Props {
		state?: LiveState;
		/** Hide the text, keep the dot (still announced). */
		dotOnly?: boolean;
		class?: string;
	}

	let { state = 'live', dotOnly = false, class: className = '' }: Props = $props();

	const text = $derived(
		state === 'live' ? 'Live' : state === 'connecting' ? 'Connecting' : 'Offline'
	);
	const title = $derived(
		state === 'live'
			? 'Live: changes from the other party appear here immediately.'
			: state === 'connecting'
				? 'Reconnecting to live updates.'
				: 'Offline. Data may be out of date.'
	);
</script>

<span class="live state-{state} {className}" {title} role="status">
	<span class="dot" aria-hidden="true"></span>
	<span class:sr-only={dotOnly}>{text}</span>
</span>

<style>
	.live {
		--c: var(--tone-success-solid);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.state-connecting {
		--c: var(--tone-warning-solid);
	}

	.state-offline {
		--c: var(--color-text-disabled);
	}

	.dot {
		position: relative;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--c);
	}

	.state-live .dot::after,
	.state-connecting .dot::after {
		content: '';
		position: absolute;
		inset: -4px;
		border-radius: 50%;
		border: 1.5px solid var(--c);
		opacity: 0;
		animation: ring 2s var(--ease-out) infinite;
	}

	@keyframes ring {
		0% {
			transform: scale(0.5);
			opacity: 0.6;
		}
		100% {
			transform: scale(1.4);
			opacity: 0;
		}
	}
</style>
