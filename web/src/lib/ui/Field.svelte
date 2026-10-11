<script lang="ts">
	import type { Snippet } from 'svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { setFieldContext } from './field-context';

	interface Props {
		label: string;
		/** Help text under the control. */
		hint?: string;
		/** Error text. Replaces the hint and marks the control invalid. */
		error?: string;
		required?: boolean;
		disabled?: boolean;
		/** Shown at the right of the label, e.g. a TempoTag or "Optional". */
		aside?: Snippet;
		/** Visually hide the label (still read by screen readers). */
		hideLabel?: boolean;
		id?: string;
		class?: string;
		children: Snippet;
	}

	let {
		label,
		hint,
		error,
		required = false,
		disabled = false,
		aside,
		hideLabel = false,
		id: idProp,
		class: className = '',
		children
	}: Props = $props();

	const uid = $props.id();
	const id = $derived(idProp ?? `field-${uid}`);
	const hintId = $derived(`${id}-hint`);
	const errorId = $derived(`${id}-error`);

	setFieldContext({
		get id() {
			return id;
		},
		get describedBy() {
			return error ? errorId : hint ? hintId : undefined;
		},
		get invalid() {
			return !!error;
		},
		get required() {
			return required;
		},
		get disabled() {
			return disabled;
		}
	});
</script>

<div class="field {className}" class:disabled>
	<div class="head" class:sr-only={hideLabel}>
		<label for={id} class="label">
			{label}
			{#if required}<span class="req" aria-hidden="true">Required</span>{/if}
		</label>
		{#if aside}<div class="aside">{@render aside()}</div>{/if}
	</div>
	{@render children()}
	{#if error}
		<p id={errorId} class="msg error" role="alert">
			<CircleAlert size={13} strokeWidth={2} aria-hidden="true" />
			{error}
		</p>
	{:else if hint}
		<p id={hintId} class="msg">{hint}</p>
	{/if}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1-5);
		min-width: 0;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		min-height: 1.25rem;
	}

	.label {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-2);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text);
	}

	.req {
		font-size: var(--text-2xs);
		font-weight: var(--weight-regular);
		color: var(--color-text-tertiary);
	}

	.aside {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.msg {
		display: flex;
		align-items: flex-start;
		gap: var(--space-1-5);
		font-size: var(--text-xs);
		line-height: var(--leading-xs);
		color: var(--color-text-tertiary);
	}

	.msg :global(svg) {
		margin-top: 1.5px;
	}

	.error {
		color: var(--tone-danger-fg);
	}

	.disabled .label {
		color: var(--color-text-disabled);
	}
</style>
