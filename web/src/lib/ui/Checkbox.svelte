<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLInputAttributes, 'type' | 'checked'> {
		checked?: boolean;
		indeterminate?: boolean;
		label?: string;
		/** Second line under the label. */
		description?: string;
		/** Custom label content. */
		children?: Snippet;
		class?: string;
	}

	let {
		checked = $bindable(false),
		indeterminate = $bindable(false),
		label,
		description,
		children,
		disabled,
		class: className = '',
		...rest
	}: Props = $props();

	const uid = $props.id();
	const id = $derived((rest.id as string | undefined) ?? `cb-${uid}`);
</script>

<label class="cb {className}" class:disabled for={id}>
	<span class="box-wrap">
		<input
			type="checkbox"
			{id}
			bind:checked
			bind:indeterminate
			{disabled}
			aria-describedby={description ? `${id}-desc` : undefined}
			{...rest}
		/>
		<span class="box" aria-hidden="true">
			<svg viewBox="0 0 12 12" class="tick"><path d="M2.5 6.2 5 8.6l4.5-5.1" /></svg>
			<svg viewBox="0 0 12 12" class="dash"><path d="M3 6h6" /></svg>
		</span>
	</span>
	{#if label || children || description}
		<span class="text">
			{#if children}{@render children()}{:else if label}<span class="label">{label}</span>{/if}
			{#if description}<span class="desc" id="{id}-desc">{description}</span>{/if}
		</span>
	{/if}
</label>

<style>
	.cb {
		display: inline-flex;
		align-items: flex-start;
		gap: var(--space-2-5);
		cursor: pointer;
		font-size: var(--text-sm);
	}

	.disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.box-wrap {
		position: relative;
		display: inline-grid;
		margin-top: 2px;
	}

	input {
		position: absolute;
		inset: 0;
		opacity: 0;
		margin: 0;
		cursor: inherit;
	}

	.box {
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-xs);
		background: var(--color-bg-elevated);
		box-shadow: var(--shadow-xs);
		transition:
			background-color var(--duration-fast) var(--ease-standard),
			border-color var(--duration-fast) var(--ease-standard);
	}

	.box svg {
		grid-area: 1 / 1;
		width: 12px;
		height: 12px;
		fill: none;
		stroke: var(--color-primary-fg);
		stroke-width: 1.75;
		stroke-linecap: round;
		stroke-linejoin: round;
		opacity: 0;
	}

	.cb:hover .box {
		border-color: var(--color-text-tertiary);
	}

	input:checked + .box,
	input:indeterminate + .box {
		background: var(--color-primary);
		border-color: var(--color-primary);
	}

	input:checked:not(:indeterminate) + .box .tick,
	input:indeterminate + .box .dash {
		opacity: 1;
	}

	input:focus-visible + .box {
		box-shadow: var(--color-focus-ring);
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.label {
		color: var(--color-text);
		font-weight: var(--weight-medium);
	}

	.desc {
		color: var(--color-text-tertiary);
		font-size: var(--text-xs);
		line-height: var(--leading-xs);
	}
</style>
