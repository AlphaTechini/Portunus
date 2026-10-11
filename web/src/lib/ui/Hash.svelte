<script lang="ts">
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import { truncateMiddle } from './format';
	import { copyText } from './copy';

	interface Props {
		/** Full address or transaction hash. */
		value: string;
		/** What it is, for screen readers and the copy confirmation. */
		kind?: 'address' | 'tx' | 'key' | 'other';
		/** Optional human label shown before the hash (e.g. "Deposit address"). */
		label?: string;
		/** Characters kept after 0x and at the end. */
		head?: number;
		tail?: number;
		/** Show the full value (wraps). */
		full?: boolean;
		copyable?: boolean;
		/** Explorer link. */
		href?: string;
		size?: 'sm' | 'md';
		class?: string;
	}

	let {
		value,
		kind = 'address',
		label,
		head = 6,
		tail = 4,
		full = false,
		copyable = true,
		href,
		size = 'md',
		class: className = ''
	}: Props = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	const shown = $derived(full ? value : truncateMiddle(value, head, tail));
	const noun = $derived(
		kind === 'tx'
			? 'transaction hash'
			: kind === 'key'
				? 'key id'
				: kind === 'address'
					? 'address'
					: 'value'
	);

	async function copy() {
		if (await copyText(value)) {
			copied = true;
			clearTimeout(timer);
			timer = setTimeout(() => (copied = false), 1600);
		}
	}
</script>

<span class="hash {size} {className}" class:full>
	{#if label}<span class="label">{label}</span>{/if}
	{#if href}
		<a class="val" {href} target="_blank" rel="noreferrer noopener" title={value}>
			<span class="sr-only">{noun}</span>{shown}<ArrowUpRight
				size={11}
				strokeWidth={2}
				aria-hidden="true"
			/>
		</a>
	{:else}
		<span class="val" title={value}><span class="sr-only">{noun} </span>{shown}</span>
	{/if}
	{#if copyable}
		<button
			type="button"
			class="copy"
			class:copied
			aria-label={copied ? `Copied ${noun}` : `Copy ${noun}`}
			onclick={copy}
		>
			{#if copied}
				<Check size={12} strokeWidth={2.25} aria-hidden="true" />
			{:else}
				<Copy size={12} strokeWidth={1.75} aria-hidden="true" />
			{/if}
		</button>
		<span class="sr-only" aria-live="polite">{copied ? 'Copied' : ''}</span>
	{/if}
</span>

<style>
	.hash {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-width: 0;
		max-width: 100%;
		vertical-align: middle;
	}

	.label {
		margin-right: var(--space-1);
		color: var(--color-text-tertiary);
		font-size: var(--text-xs);
	}

	.val {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		letter-spacing: 0;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.sm .val {
		font-size: 0.6875rem;
	}

	.full .val {
		white-space: normal;
		word-break: break-all;
	}

	a.val {
		color: var(--color-accent-text);
	}

	a.val:hover {
		text-decoration: underline;
	}

	.copy {
		display: inline-grid;
		place-items: center;
		width: 1.375rem;
		height: 1.375rem;
		border-radius: var(--radius-xs);
		color: var(--color-text-tertiary);
		transition:
			color var(--duration-fast) var(--ease-standard),
			background-color var(--duration-fast) var(--ease-standard);
	}

	.copy:hover {
		color: var(--color-text);
		background: var(--color-surface-hover);
	}

	.copy:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
	}

	.copy.copied {
		color: var(--tone-success-fg);
	}
</style>
