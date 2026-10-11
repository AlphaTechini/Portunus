<script lang="ts" generics="V extends string">
	import type { SegmentedOption } from './types';

	interface Props {
		options: SegmentedOption<V>[];
		value?: V;
		/** Accessible name for the group. */
		label: string;
		/** 'pill' is a compact track; 'cards' shows descriptions (deposit mode choice). */
		variant?: 'pill' | 'cards';
		size?: 'sm' | 'md';
		fullWidth?: boolean;
		disabled?: boolean;
		onchange?: (value: V) => void;
		class?: string;
	}

	let {
		options,
		value = $bindable(),
		label,
		variant = 'pill',
		size = 'md',
		fullWidth = false,
		disabled = false,
		onchange,
		class: className = ''
	}: Props = $props();

	const uid = $props.id();
	let buttons: HTMLButtonElement[] = $state([]);

	const enabled = $derived(options.filter((o) => !o.disabled && !disabled));
	const activeIndex = $derived(options.findIndex((o) => o.value === value));
	const focusIndex = $derived(
		activeIndex >= 0 ? activeIndex : options.findIndex((o) => !o.disabled)
	);

	function select(v: V) {
		if (disabled) return;
		value = v;
		onchange?.(v);
	}

	function onkeydown(e: KeyboardEvent, index: number) {
		const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
		if (!keys.includes(e.key) || !enabled.length) return;
		e.preventDefault();
		const current = enabled.findIndex((o) => o.value === options[index].value);
		let next = current;
		if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (current + 1) % enabled.length;
		if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
			next = (current - 1 + enabled.length) % enabled.length;
		if (e.key === 'Home') next = 0;
		if (e.key === 'End') next = enabled.length - 1;
		const opt = enabled[next];
		select(opt.value);
		buttons[options.indexOf(opt)]?.focus();
	}
</script>

<div
	role="radiogroup"
	aria-label={label}
	class="seg {variant} {size} {className}"
	class:full={fullWidth}
	class:disabled
	style:--count={options.length}
	style:--active={Math.max(activeIndex, 0)}
>
	{#if variant === 'pill' && activeIndex >= 0}
		<span class="indicator" aria-hidden="true"></span>
	{/if}
	{#each options as opt, i (opt.value)}
		{@const checked = opt.value === value}
		<button
			bind:this={buttons[i]}
			type="button"
			role="radio"
			aria-checked={checked}
			aria-describedby={opt.description && variant === 'cards' ? `seg-${uid}-${i}` : undefined}
			tabindex={i === focusIndex ? 0 : -1}
			disabled={disabled || opt.disabled}
			class="opt"
			onclick={() => select(opt.value)}
			onkeydown={(e) => onkeydown(e, i)}
		>
			{#if variant === 'cards'}
				<span class="card-head">
					<span class="radio" aria-hidden="true"></span>
					{#if opt.icon}<opt.icon size={16} strokeWidth={1.75} aria-hidden="true" />{/if}
					<span class="opt-label">{opt.label}</span>
				</span>
				{#if opt.description}
					<span class="desc" id="seg-{uid}-{i}">{opt.description}</span>
				{/if}
			{:else}
				{#if opt.icon}<opt.icon size={14} strokeWidth={1.75} aria-hidden="true" />{/if}
				<span class="opt-label">{opt.label}</span>
			{/if}
		</button>
	{/each}
</div>

<style>
	/* ---------- pill ---------- */
	.pill {
		position: relative;
		display: inline-grid;
		grid-template-columns: repeat(var(--count), minmax(0, 1fr));
		padding: 3px;
		border-radius: calc(var(--radius-md) + 1px);
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		isolation: isolate;
	}

	.pill.full {
		display: grid;
		width: 100%;
	}

	.pill .indicator {
		position: absolute;
		z-index: -1;
		top: 3px;
		bottom: 3px;
		left: 3px;
		width: calc((100% - 6px) / var(--count));
		transform: translateX(calc(100% * var(--active)));
		border-radius: var(--radius-sm);
		background: var(--color-surface-raised);
		box-shadow:
			var(--shadow-sm),
			0 0 0 1px var(--color-border-subtle);
		transition: transform var(--duration-base) var(--ease-out);
	}

	.pill .opt {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1-5);
		height: 1.875rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text-secondary);
		white-space: nowrap;
		transition: color var(--duration-fast) var(--ease-standard);
	}

	.pill.sm .opt {
		height: 1.5rem;
		padding: 0 var(--space-2-5);
		font-size: var(--text-xs);
	}

	.pill .opt:hover:not(:disabled) {
		color: var(--color-text);
	}

	.pill .opt[aria-checked='true'] {
		color: var(--color-text);
	}

	.pill .opt:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
	}

	/* ---------- cards ---------- */
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: var(--space-3);
	}

	.cards .opt {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1-5);
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-xs);
		text-align: left;
		transition:
			border-color var(--duration-fast) var(--ease-standard),
			box-shadow var(--duration-fast) var(--ease-standard),
			background-color var(--duration-fast) var(--ease-standard);
	}

	.cards .opt:hover:not(:disabled) {
		border-color: var(--color-border-strong);
	}

	.cards .opt[aria-checked='true'] {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 1px var(--color-accent);
		background: color-mix(in srgb, var(--color-accent-subtle) 55%, var(--color-surface));
	}

	.cards .opt:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
	}

	.card-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-text);
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
	}

	.radio {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 1px solid var(--color-border-strong);
		background: var(--color-bg-elevated);
		transition:
			border-color var(--duration-fast) var(--ease-standard),
			border-width var(--duration-fast) var(--ease-standard);
	}

	.opt[aria-checked='true'] .radio {
		border: 5px solid var(--color-accent);
	}

	.desc {
		padding-left: calc(16px + var(--space-2));
		font-size: var(--text-xs);
		line-height: var(--leading-xs);
		color: var(--color-text-secondary);
	}

	.opt:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
