<script lang="ts">
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import { getFieldContext } from './field-context';
	import type { SelectOption } from './types';

	interface Props extends Omit<HTMLSelectAttributes, 'size' | 'value'> {
		value?: string;
		options: SelectOption[];
		placeholder?: string;
		size?: 'sm' | 'md' | 'lg';
		invalid?: boolean;
		class?: string;
	}

	let {
		value = $bindable(),
		options,
		placeholder,
		size = 'md',
		invalid,
		id,
		disabled,
		class: className = '',
		...rest
	}: Props = $props();

	const field = getFieldContext();
	const isInvalid = $derived(invalid ?? field?.invalid ?? false);
	const isDisabled = $derived(disabled ?? field?.disabled ?? false);
</script>

<div class="select {size} {className}" class:invalid={isInvalid} class:disabled={isDisabled}>
	<select
		bind:value
		id={id ?? field?.id}
		disabled={isDisabled}
		aria-invalid={isInvalid || undefined}
		aria-describedby={field?.describedBy}
		class:placeholder={!value}
		{...rest}
	>
		{#if placeholder}<option value="" disabled>{placeholder}</option>{/if}
		{#each options as opt (opt.value)}
			<option value={opt.value} disabled={opt.disabled}>{opt.label}</option>
		{/each}
	</select>
	<ChevronsUpDown class="chev" size={14} strokeWidth={1.75} aria-hidden="true" />
</div>

<style>
	.select {
		--h: 2.25rem;
		position: relative;
		display: flex;
		min-width: 0;
	}

	.sm {
		--h: 1.875rem;
	}

	.lg {
		--h: 2.75rem;
	}

	select {
		width: 100%;
		height: var(--h);
		padding: 0 var(--space-8) 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-elevated);
		box-shadow: var(--shadow-xs);
		color: var(--color-text);
		font-size: var(--text-sm);
		appearance: none;
		cursor: pointer;
		transition: border-color var(--duration-fast) var(--ease-standard);
	}

	select.placeholder {
		color: var(--color-text-disabled);
	}

	select:hover:not(:disabled) {
		border-color: var(--color-border-strong);
	}

	select:focus-visible {
		outline: none;
		border-color: var(--color-focus);
		box-shadow: 0 0 0 3px var(--color-selection);
	}

	.invalid select {
		border-color: var(--tone-danger-solid);
	}

	select:disabled {
		background: var(--color-surface-sunken);
		color: var(--color-text-tertiary);
		cursor: not-allowed;
		box-shadow: none;
	}

	.select :global(.chev) {
		position: absolute;
		right: var(--space-3);
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-tertiary);
		pointer-events: none;
	}
</style>
