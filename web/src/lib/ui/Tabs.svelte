<script lang="ts" generics="V extends string">
	import type { Snippet } from 'svelte';
	import type { TabItem } from './types';

	interface Props {
		items: TabItem<V>[];
		value?: V;
		/** Accessible name for the tab list. */
		label: string;
		variant?: 'underline' | 'pill';
		/** Renders the active panel. Receives the active value. */
		panel?: Snippet<[V]>;
		onchange?: (value: V) => void;
		class?: string;
	}

	let {
		items,
		value = $bindable(),
		label,
		variant = 'underline',
		panel,
		onchange,
		class: className = ''
	}: Props = $props();

	const uid = $props.id();
	let tabs: HTMLButtonElement[] = $state([]);

	const active = $derived(value ?? items.find((i) => !i.disabled)?.value);
	const enabled = $derived(items.filter((i) => !i.disabled));

	function select(v: V) {
		value = v;
		onchange?.(v);
	}

	function onkeydown(e: KeyboardEvent) {
		const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
		if (!keys.includes(e.key)) return;
		e.preventDefault();
		const cur = enabled.findIndex((i) => i.value === active);
		let next = cur;
		if (e.key === 'ArrowRight') next = (cur + 1) % enabled.length;
		if (e.key === 'ArrowLeft') next = (cur - 1 + enabled.length) % enabled.length;
		if (e.key === 'Home') next = 0;
		if (e.key === 'End') next = enabled.length - 1;
		const item = enabled[next];
		select(item.value);
		tabs[items.indexOf(item)]?.focus();
	}
</script>

<div class="tabs {variant} {className}">
	<div role="tablist" aria-label={label} class="list" tabindex="-1" {onkeydown}>
		{#each items as item, i (item.value)}
			{@const selected = item.value === active}
			<button
				bind:this={tabs[i]}
				type="button"
				role="tab"
				id="tab-{uid}-{item.value}"
				aria-selected={selected}
				aria-controls="panel-{uid}-{item.value}"
				tabindex={selected ? 0 : -1}
				disabled={item.disabled}
				class="tab"
				onclick={() => select(item.value)}
			>
				{#if item.icon}<item.icon size={14} strokeWidth={1.75} aria-hidden="true" />{/if}
				<span>{item.label}</span>
				{#if item.count !== undefined}<span class="count tabular">{item.count}</span>{/if}
			</button>
		{/each}
	</div>
	{#if panel && active}
		<div
			role="tabpanel"
			id="panel-{uid}-{active}"
			aria-labelledby="tab-{uid}-{active}"
			class="panel"
			tabindex="0"
		>
			{@render panel(active)}
		</div>
	{/if}
</div>

<style>
	.list {
		display: flex;
		gap: var(--space-1);
		overflow-x: auto;
		scrollbar-width: none;
	}

	.list::-webkit-scrollbar {
		display: none;
	}

	.list:focus-visible {
		outline: none;
	}

	.tab {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: var(--space-1-5);
		height: 2.25rem;
		padding: 0 var(--space-3);
		color: var(--color-text-secondary);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		white-space: nowrap;
		border-radius: var(--radius-sm);
		transition:
			color var(--duration-fast) var(--ease-standard),
			background-color var(--duration-fast) var(--ease-standard);
	}

	.tab:hover:not(:disabled) {
		color: var(--color-text);
	}

	.tab[aria-selected='true'] {
		color: var(--color-text);
	}

	.tab:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.tab:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 2px var(--color-focus);
	}

	.count {
		min-width: 1.25rem;
		height: 1.125rem;
		padding: 0 5px;
		border-radius: var(--radius-full);
		background: var(--color-surface-active);
		color: var(--color-text-secondary);
		font-size: var(--text-2xs);
		line-height: 1.125rem;
		text-align: center;
	}

	/* underline */
	.underline .list {
		border-bottom: 1px solid var(--color-border);
		gap: var(--space-4);
	}

	.underline .tab {
		padding: 0 2px;
		height: 2.5rem;
		border-radius: 0;
	}

	.underline .tab::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: -1px;
		height: 2px;
		border-radius: 2px 2px 0 0;
		background: var(--color-text);
		transform: scaleX(0);
		transition: transform var(--duration-base) var(--ease-out);
	}

	.underline .tab[aria-selected='true']::after {
		transform: scaleX(1);
	}

	/* pill */
	.pill .tab:hover:not(:disabled) {
		background: var(--color-surface-hover);
	}

	.pill .tab[aria-selected='true'] {
		background: var(--color-surface-active);
	}

	.panel {
		padding-top: var(--space-5);
	}

	.panel:focus-visible {
		outline: none;
	}
</style>
