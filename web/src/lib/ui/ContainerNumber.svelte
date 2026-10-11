<script lang="ts">
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import { parseContainerNumber } from './format';
	import { copyText } from './copy';

	interface Props {
		/** Raw or formatted ISO 6346 number: "MSCU1234565" or "MSCU 123456-5". */
		value: string;
		/** Size/type code shown as a chip, e.g. "40HC", "20GP". */
		type?: string;
		size?: 'sm' | 'md' | 'lg';
		copyable?: boolean;
		/** Link to the container detail page. */
		href?: string;
		/** Warn when the check digit is wrong (forms, release requests). */
		validate?: boolean;
		class?: string;
	}

	let {
		value,
		type,
		size = 'md',
		copyable = false,
		href,
		validate = false,
		class: className = ''
	}: Props = $props();

	const p = $derived(parseContainerNumber(value));
	let copied = $state(false);

	async function copy() {
		if (await copyText(`${p.owner}${p.serial}${p.check}`)) {
			copied = true;
			setTimeout(() => (copied = false), 1500);
		}
	}
</script>

<span class="cn {size} {className}" class:invalid={validate && !p.valid}>
	<svelte:element
		this={href ? 'a' : 'span'}
		{href}
		class="num"
		aria-label="Container {p.owner} {p.serial.split('').join(' ')} check digit {p.check}"
	>
		<span class="owner">{p.owner}</span>
		<span class="serial">{p.serial}</span>{#if p.check}<span class="check">{p.check}</span>{/if}
	</svelte:element>
	{#if type}<span class="type">{type}</span>{/if}
	{#if validate && !p.valid}<span class="warn">Check digit does not match</span>{/if}
	{#if copyable}
		<button
			type="button"
			class="copy"
			aria-label={copied ? 'Copied container number' : 'Copy container number'}
			onclick={copy}
		>
			{#if copied}<Check size={12} strokeWidth={2.25} aria-hidden="true" />{:else}<Copy
					size={12}
					strokeWidth={1.75}
					aria-hidden="true"
				/>{/if}
		</button>
	{/if}
</span>

<style>
	.cn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		white-space: nowrap;
		vertical-align: middle;
	}

	.num {
		display: inline-flex;
		align-items: baseline;
		gap: 0.4em;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		font-weight: 500;
		letter-spacing: 0.01em;
		color: var(--color-text);
	}

	a.num:hover {
		text-decoration: none;
	}

	a.num:hover .serial,
	a.num:hover .owner {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.sm .num {
		font-size: 0.75rem;
	}

	.lg .num {
		font-size: var(--text-xl);
		letter-spacing: 0;
	}

	.owner {
		font-weight: 600;
	}

	.check {
		margin-left: -0.4em;
		color: var(--color-text-tertiary);
	}

	.check::before {
		content: '-';
	}

	.type {
		padding: 1px 5px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xs);
		color: var(--color-text-secondary);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		line-height: 1rem;
	}

	.lg .type {
		font-size: var(--text-xs);
		padding: 2px 6px;
	}

	.invalid .num {
		color: var(--tone-danger-fg);
	}

	.warn {
		font-size: var(--text-xs);
		color: var(--tone-danger-fg);
	}

	.copy {
		display: inline-grid;
		place-items: center;
		width: 1.375rem;
		height: 1.375rem;
		border-radius: var(--radius-xs);
		color: var(--color-text-tertiary);
	}

	.copy:hover {
		color: var(--color-text);
		background: var(--color-surface-hover);
	}

	.copy:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
	}
</style>
