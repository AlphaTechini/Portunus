<script lang="ts">
	interface Props {
		checked?: boolean;
		label: string;
		description?: string;
		/** Hide the label visually (keeps it for screen readers). */
		hideLabel?: boolean;
		disabled?: boolean;
		size?: 'sm' | 'md';
		onchange?: (checked: boolean) => void;
		class?: string;
	}

	let {
		checked = $bindable(false),
		label,
		description,
		hideLabel = false,
		disabled = false,
		size = 'md',
		onchange,
		class: className = ''
	}: Props = $props();

	const uid = $props.id();

	function toggle() {
		if (disabled) return;
		checked = !checked;
		onchange?.(checked);
	}
</script>

<div class="sw-row {size} {className}" class:disabled>
	<button
		type="button"
		role="switch"
		aria-checked={checked}
		aria-labelledby="sw-{uid}-label"
		aria-describedby={description ? `sw-${uid}-desc` : undefined}
		class="sw"
		{disabled}
		onclick={toggle}
	>
		<span class="thumb"></span>
	</button>
	<span class="text" class:sr-only={hideLabel}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<span id="sw-{uid}-label" class="label" onclick={toggle}>{label}</span>
		{#if description}<span id="sw-{uid}-desc" class="desc">{description}</span>{/if}
	</span>
</div>

<style>
	.sw-row {
		display: inline-flex;
		align-items: flex-start;
		gap: var(--space-2-5);
	}

	.disabled {
		opacity: 0.55;
	}

	.sw {
		--w: 32px;
		--h: 18px;
		position: relative;
		flex-shrink: 0;
		width: var(--w);
		height: var(--h);
		margin-top: 1px;
		border-radius: var(--radius-full);
		background: var(--color-border-strong);
		transition: background-color var(--duration-base) var(--ease-standard);
	}

	.sm .sw {
		--w: 26px;
		--h: 14px;
		margin-top: 3px;
	}

	.sw[aria-checked='true'] {
		background: var(--color-accent);
	}

	.thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: calc(var(--h) - 4px);
		height: calc(var(--h) - 4px);
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
		transition: transform var(--duration-base) var(--ease-out);
	}

	.sw[aria-checked='true'] .thumb {
		transform: translateX(calc(var(--w) - var(--h)));
	}

	.sw:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.label {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text);
		cursor: pointer;
		user-select: none;
	}

	.desc {
		font-size: var(--text-xs);
		line-height: var(--leading-xs);
		color: var(--color-text-tertiary);
	}
</style>
