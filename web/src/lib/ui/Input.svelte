<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';
	import type { IconComponent } from './status';
	import { getFieldContext } from './field-context';

	interface Props extends Omit<HTMLInputAttributes, 'size' | 'prefix'> {
		value?: string | number | null;
		size?: 'sm' | 'md' | 'lg';
		/** Leading icon. */
		icon?: IconComponent;
		/** Short text before the value, e.g. "$". */
		prefix?: string;
		/** Short text after the value, e.g. "USD" or "days". */
		suffix?: string;
		/** Trailing interactive content (e.g. an IconButton). */
		trailing?: Snippet;
		/** Monospace: container numbers, B/L numbers, addresses. */
		mono?: boolean;
		/** Right-aligned tabular numerals: amounts, days. */
		numeric?: boolean;
		invalid?: boolean;
		ref?: HTMLInputElement;
		class?: string;
	}

	let {
		value = $bindable(),
		size = 'md',
		icon: Icon,
		prefix,
		suffix,
		trailing,
		mono = false,
		numeric = false,
		invalid,
		ref = $bindable(),
		id,
		disabled,
		required,
		class: className = '',
		type = 'text',
		...rest
	}: Props = $props();

	const field = getFieldContext();
	const isInvalid = $derived(invalid ?? field?.invalid ?? false);
	const isDisabled = $derived(disabled ?? field?.disabled ?? false);
</script>

<div
	class="control {size} {className}"
	class:invalid={isInvalid}
	class:disabled={isDisabled}
	class:mono
	class:numeric
>
	{#if Icon}<span class="adorn icon"><Icon size={15} strokeWidth={1.75} aria-hidden="true" /></span
		>{/if}
	{#if prefix}<span class="adorn text">{prefix}</span>{/if}
	<input
		bind:this={ref}
		bind:value
		{type}
		id={id ?? field?.id}
		disabled={isDisabled}
		required={required ?? field?.required}
		aria-invalid={isInvalid || undefined}
		aria-describedby={field?.describedBy}
		inputmode={numeric && type === 'text' ? 'decimal' : undefined}
		{...rest}
	/>
	{#if suffix}<span class="adorn text">{suffix}</span>{/if}
	{#if trailing}<span class="adorn trailing">{@render trailing()}</span>{/if}
</div>

<style>
	.control {
		--h: 2.25rem;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: var(--h);
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-elevated);
		box-shadow: var(--shadow-xs);
		transition:
			border-color var(--duration-fast) var(--ease-standard),
			box-shadow var(--duration-fast) var(--ease-standard);
		min-width: 0;
	}

	.sm {
		--h: 1.875rem;
		padding: 0 var(--space-2-5);
		border-radius: var(--radius-sm);
	}

	.lg {
		--h: 2.75rem;
		padding: 0 var(--space-4);
	}

	.control:hover:not(.disabled) {
		border-color: var(--color-border-strong);
	}

	.control:focus-within {
		border-color: var(--color-focus);
		box-shadow: 0 0 0 3px var(--color-selection);
	}

	.invalid,
	.invalid:hover:not(.disabled) {
		border-color: var(--tone-danger-solid);
	}

	.invalid:focus-within {
		box-shadow: 0 0 0 3px var(--tone-danger-bg);
	}

	.disabled {
		background: var(--color-surface-sunken);
		box-shadow: none;
	}

	input {
		flex: 1;
		min-width: 0;
		height: 100%;
		border: 0;
		outline: none;
		background: transparent;
		color: var(--color-text);
		font-size: var(--text-sm);
	}

	.lg input {
		font-size: var(--text-base);
	}

	input::placeholder {
		color: var(--color-text-disabled);
	}

	input:disabled {
		color: var(--color-text-tertiary);
		cursor: not-allowed;
	}

	input:focus-visible {
		outline: none;
	}

	.mono input {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		letter-spacing: 0.01em;
	}

	.numeric input {
		text-align: right;
		font-variant-numeric: tabular-nums;
		font-feature-settings: var(--font-features-numeric);
	}

	.adorn {
		display: inline-flex;
		align-items: center;
		color: var(--color-text-tertiary);
		flex-shrink: 0;
	}

	.adorn.text {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
	}

	.adorn.trailing {
		margin-right: calc(var(--space-1-5) * -1);
	}

	/* hide number spinners: amounts are typed, not nudged */
	input[type='number']::-webkit-outer-spin-button,
	input[type='number']::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}

	input[type='number'] {
		-moz-appearance: textfield;
		appearance: textfield;
	}

	@media (pointer: coarse) {
		input {
			font-size: var(--text-md);
		}
	}
</style>
