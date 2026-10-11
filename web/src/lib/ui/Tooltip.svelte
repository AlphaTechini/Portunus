<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onDestroy } from 'svelte';

	type Placement = 'top' | 'bottom' | 'left' | 'right';

	interface Props {
		/** Plain text tooltip. */
		text?: string;
		/** Rich content (overrides text). */
		content?: Snippet;
		placement?: Placement;
		/** 'plain' is a small ink label; 'rich' is a card that can hold a link. */
		variant?: 'plain' | 'rich';
		/** Keep open while the pointer is over the tooltip (needed for links). */
		interactive?: boolean;
		delay?: number;
		/** Inline wrapper display. */
		block?: boolean;
		disabled?: boolean;
		children: Snippet;
	}

	let {
		text,
		content,
		placement = 'top',
		variant = 'plain',
		interactive = false,
		delay = 280,
		block = false,
		disabled = false,
		children
	}: Props = $props();

	const id = $props.id();
	const tipId = `tip-${id}`;

	let wrapper: HTMLElement | undefined = $state();
	let tip: HTMLElement | undefined = $state();
	let open = $state(false);
	let actual: Placement = $state('top');
	let showTimer: ReturnType<typeof setTimeout> | undefined;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;

	function target(): HTMLElement | null {
		if (!wrapper) return null;
		return (
			wrapper.querySelector<HTMLElement>(
				'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
			) ?? wrapper
		);
	}

	$effect(() => {
		const el = target();
		if (!el || disabled) return;
		const prev = el.getAttribute('aria-describedby');
		if (!prev?.includes(tipId)) {
			el.setAttribute('aria-describedby', [prev, tipId].filter(Boolean).join(' '));
		}
		return () => {
			const cur = el.getAttribute('aria-describedby') ?? '';
			const next = cur
				.split(' ')
				.filter((t) => t && t !== tipId)
				.join(' ');
			if (next) el.setAttribute('aria-describedby', next);
			else el.removeAttribute('aria-describedby');
		};
	});

	function position() {
		const el = target();
		if (!el || !tip) return;
		const r = el.getBoundingClientRect();
		const t = tip.getBoundingClientRect();
		const gap = 8;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		let p: Placement = placement;
		if (p === 'top' && r.top - t.height - gap < 4) p = 'bottom';
		else if (p === 'bottom' && r.bottom + t.height + gap > vh - 4) p = 'top';
		else if (p === 'left' && r.left - t.width - gap < 4) p = 'right';
		else if (p === 'right' && r.right + t.width + gap > vw - 4) p = 'left';
		let top = 0;
		let left = 0;
		if (p === 'top' || p === 'bottom') {
			top = p === 'top' ? r.top - t.height - gap : r.bottom + gap;
			left = r.left + r.width / 2 - t.width / 2;
		} else {
			top = r.top + r.height / 2 - t.height / 2;
			left = p === 'left' ? r.left - t.width - gap : r.right + gap;
		}
		left = Math.max(8, Math.min(left, vw - t.width - 8));
		top = Math.max(8, Math.min(top, vh - t.height - 8));
		tip.style.top = `${Math.round(top)}px`;
		tip.style.left = `${Math.round(left)}px`;
		actual = p;
	}

	function reveal() {
		if (!tip || disabled) return;
		open = true;
		try {
			if (!tip.matches(':popover-open')) tip.showPopover();
		} catch {
			/* popover unsupported: falls back to fixed positioning */
		}
		position();
	}

	function show(immediate = false) {
		clearTimeout(hideTimer);
		clearTimeout(showTimer);
		if (open) return;
		if (immediate) reveal();
		else showTimer = setTimeout(reveal, delay);
	}

	function hide(immediate = false) {
		clearTimeout(showTimer);
		clearTimeout(hideTimer);
		const run = () => {
			open = false;
			try {
				if (tip?.matches(':popover-open')) tip.hidePopover();
			} catch {
				/* ignore */
			}
		};
		if (immediate) run();
		else hideTimer = setTimeout(run, interactive ? 160 : 60);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			e.stopPropagation();
			hide(true);
		}
	}

	function onfocusout(e: FocusEvent) {
		const next = e.relatedTarget as Node | null;
		if (next && (wrapper?.contains(next) || tip?.contains(next))) return;
		hide();
	}

	$effect(() => {
		if (!open) return;
		const update = () => position();
		window.addEventListener('scroll', update, true);
		window.addEventListener('resize', update);
		return () => {
			window.removeEventListener('scroll', update, true);
			window.removeEventListener('resize', update);
		};
	});

	onDestroy(() => {
		clearTimeout(showTimer);
		clearTimeout(hideTimer);
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
	class="tt-wrap"
	class:block
	bind:this={wrapper}
	onpointerenter={(e) => e.pointerType !== 'touch' && show()}
	onpointerleave={() => hide()}
	onfocusin={() => show(true)}
	{onfocusout}
	{onkeydown}
>
	{@render children()}
</span>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={tip}
	id={tipId}
	role="tooltip"
	popover="manual"
	class="tt {variant}"
	data-placement={actual}
	data-open={open}
	onpointerenter={() => interactive && show(true)}
	onpointerleave={() => interactive && hide()}
	{onfocusout}
	{onkeydown}
>
	{#if content}{@render content()}{:else}{text}{/if}
</div>

<style>
	.tt-wrap {
		display: inline-flex;
		max-width: 100%;
	}

	.tt-wrap.block {
		display: flex;
	}

	.tt {
		position: fixed;
		inset: auto;
		margin: 0;
		z-index: var(--z-tooltip);
		pointer-events: none;
		opacity: 0;
		transform: translateY(2px);
		transition:
			opacity var(--duration-fast) var(--ease-out),
			transform var(--duration-fast) var(--ease-out);
	}

	.tt:not(:popover-open):not([data-open='true']) {
		display: none;
	}

	.tt[data-open='true'] {
		opacity: 1;
		transform: none;
		pointer-events: auto;
	}

	.tt[data-placement='bottom'] {
		transform: translateY(-2px);
	}

	.tt[data-open='true'][data-placement='bottom'] {
		transform: none;
	}

	.plain {
		max-width: 18rem;
		padding: var(--space-1-5) var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: var(--color-surface-inverse);
		color: var(--color-text-inverse);
		font-size: var(--text-xs);
		line-height: var(--leading-xs);
		font-weight: var(--weight-medium);
		box-shadow: var(--shadow-md);
	}

	.rich {
		width: max-content;
		max-width: min(22rem, calc(100vw - 16px));
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface-raised);
		color: var(--color-text);
		font-size: var(--text-sm);
		line-height: var(--leading-sm);
		box-shadow: var(--shadow-overlay);
		text-align: left;
	}
</style>
