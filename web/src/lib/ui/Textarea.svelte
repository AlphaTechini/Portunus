<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import { getFieldContext } from './field-context';

	interface Props extends Omit<HTMLTextareaAttributes, 'value'> {
		value?: string;
		invalid?: boolean;
		/** Show a live character count against maxlength. */
		showCount?: boolean;
		class?: string;
	}

	let {
		value = $bindable(''),
		invalid,
		showCount = false,
		id,
		disabled,
		rows = 4,
		maxlength,
		class: className = '',
		...rest
	}: Props = $props();

	const field = getFieldContext();
	const isInvalid = $derived(invalid ?? field?.invalid ?? false);
	const isDisabled = $derived(disabled ?? field?.disabled ?? false);
</script>

<div class="ta {className}" class:invalid={isInvalid}>
	<textarea
		bind:value
		id={id ?? field?.id}
		disabled={isDisabled}
		{rows}
		{maxlength}
		aria-invalid={isInvalid || undefined}
		aria-describedby={field?.describedBy}
		{...rest}></textarea>
	{#if showCount && maxlength}
		<span class="count tabular" aria-live="polite">{value?.length ?? 0} / {maxlength}</span>
	{/if}
</div>

<style>
	.ta {
		position: relative;
		display: flex;
	}

	textarea {
		width: 100%;
		min-height: 5rem;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-elevated);
		box-shadow: var(--shadow-xs);
		color: var(--color-text);
		font-size: var(--text-sm);
		line-height: var(--leading-sm);
		resize: vertical;
		transition: border-color var(--duration-fast) var(--ease-standard);
	}

	textarea::placeholder {
		color: var(--color-text-disabled);
	}

	textarea:hover:not(:disabled) {
		border-color: var(--color-border-strong);
	}

	textarea:focus-visible {
		outline: none;
		border-color: var(--color-focus);
		box-shadow: 0 0 0 3px var(--color-selection);
	}

	.invalid textarea {
		border-color: var(--tone-danger-solid);
	}

	textarea:disabled {
		background: var(--color-surface-sunken);
		color: var(--color-text-tertiary);
	}

	.count {
		position: absolute;
		right: var(--space-2-5);
		bottom: var(--space-2);
		font-size: var(--text-2xs);
		color: var(--color-text-tertiary);
		pointer-events: none;
	}
</style>
