<script lang="ts">
	import Check from '@lucide/svelte/icons/check';

	type State = 'idle' | 'waiting' | 'success' | 'error';

	interface Props {
		state?: State;
		/** Main label. */
		label?: string;
		/** Second line. */
		sublabel?: string;
		/** Label while the OS passkey sheet is open. */
		waitingLabel?: string;
		successLabel?: string;
		errorLabel?: string;
		/** 'face' (Face ID style) or 'fingerprint'. */
		glyph?: 'face' | 'fingerprint';
		variant?: 'primary' | 'secondary';
		fullWidth?: boolean;
		disabled?: boolean;
		type?: 'button' | 'submit';
		/** Render as a link (e.g. landing CTA to /signin). */
		href?: string;
		onclick?: (e: MouseEvent) => void;
		class?: string;
	}

	let {
		state = 'idle',
		label = 'Sign in with passkey',
		sublabel = 'Face ID, fingerprint or device PIN',
		waitingLabel = 'Waiting for your device',
		successLabel = 'Signed in',
		errorLabel = 'Not completed. Try again',
		glyph = 'face',
		variant = 'primary',
		fullWidth = false,
		disabled = false,
		type = 'button',
		href,
		onclick,
		class: className = ''
	}: Props = $props();

	const text = $derived(
		state === 'waiting'
			? waitingLabel
			: state === 'success'
				? successLabel
				: state === 'error'
					? errorLabel
					: label
	);
</script>

<svelte:element
	this={href ? 'a' : 'button'}
	{href}
	type={href ? undefined : type}
	class="pk {variant} state-{state} {className}"
	class:full={fullWidth}
	disabled={href ? undefined : disabled || state === 'waiting' || state === 'success'}
	aria-busy={state === 'waiting' || undefined}
	role={href ? 'link' : 'button'}
	{onclick}
>
	<span class="tile" aria-hidden="true">
		{#if state === 'success'}
			<Check size={20} strokeWidth={2.25} />
		{:else if glyph === 'face'}
			<svg
				viewBox="0 0 24 24"
				width="24"
				height="24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8" />
				<path d="M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8" />
				<path d="M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16" />
				<path d="M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
				<path d="M8.5 9v1.5" />
				<path d="M15.5 9v1.5" />
				<path d="M12 9v4.2h-1" />
				<path d="M9 16.2c1.8 1.4 4.2 1.4 6 0" />
				<line class="scan" x1="4" x2="20" y1="12" y2="12" />
			</svg>
		{:else}
			<svg
				viewBox="0 0 24 24"
				width="24"
				height="24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
				<path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
				<path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
				<path d="M2 12a10 10 0 0 1 18-6" />
				<path d="M2 16h.01" />
				<path d="M21.8 16c.2-2 .131-5.354 0-6" />
				<path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
				<path d="M8.65 22c.21-.66.45-1.32.57-2" />
				<path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
				<line class="scan" x1="2" x2="22" y1="12" y2="12" />
			</svg>
		{/if}
	</span>
	<span class="text">
		<span class="label">{text}</span>
		{#if state === 'idle' && sublabel}<span class="sub">{sublabel}</span>{/if}
		{#if state === 'waiting'}<span class="sub">Approve on the prompt from your device</span>{/if}
	</span>
	<span class="sr-only" aria-live="polite">{state === 'idle' ? '' : text}</span>
</svelte:element>

<style>
	.pk {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		min-height: 3.5rem;
		padding: var(--space-2) var(--space-5) var(--space-2) var(--space-2);
		border: 1px solid transparent;
		border-radius: var(--radius-lg);
		text-align: left;
		transition:
			background-color var(--duration-fast) var(--ease-standard),
			box-shadow var(--duration-base) var(--ease-standard),
			transform var(--duration-instant) var(--ease-standard);
	}

	.full {
		width: 100%;
	}

	a.pk:hover {
		text-decoration: none;
	}

	.pk:active:not(:disabled) {
		transform: translateY(0.5px);
	}

	.pk:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
	}

	.primary {
		background: var(--color-primary);
		color: var(--color-primary-fg);
		box-shadow:
			var(--shadow-md),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}

	.secondary {
		background: var(--color-surface);
		color: var(--color-text);
		border-color: var(--color-border);
		box-shadow: var(--shadow-sm);
	}

	.secondary:hover:not(:disabled) {
		border-color: var(--color-border-strong);
	}

	.pk:disabled {
		cursor: default;
	}

	.tile {
		position: relative;
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: var(--radius-md);
		overflow: hidden;
		flex-shrink: 0;
		transition:
			background-color var(--duration-base) var(--ease-standard),
			color var(--duration-base) var(--ease-standard);
	}

	.primary .tile {
		background: color-mix(in srgb, var(--color-primary-fg) 12%, transparent);
	}

	.secondary .tile {
		background: var(--color-accent-subtle);
		color: var(--color-accent-text);
	}

	.state-success .tile {
		background: var(--tone-success-solid);
		color: #fff;
	}

	.state-error .tile {
		background: var(--tone-danger-solid);
		color: #fff;
	}

	.scan {
		opacity: 0;
		stroke-width: 1.2;
	}

	.state-waiting .scan {
		opacity: 1;
		animation: scan 1.3s var(--ease-in-out) infinite alternate;
	}

	.state-waiting .tile {
		color: var(--color-accent-text);
	}

	.primary.state-waiting .tile {
		color: var(--color-primary-fg);
		animation: breathe 1.3s var(--ease-in-out) infinite alternate;
	}

	@keyframes scan {
		from {
			transform: translateY(-7px);
		}
		to {
			transform: translateY(7px);
		}
	}

	@keyframes breathe {
		to {
			background: color-mix(in srgb, var(--color-primary-fg) 22%, transparent);
		}
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.label {
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
		letter-spacing: -0.006em;
	}

	.sub {
		font-size: var(--text-xs);
		opacity: 0.68;
	}
</style>
