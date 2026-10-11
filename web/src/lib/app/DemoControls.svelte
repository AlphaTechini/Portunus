<script lang="ts">
	/**
	 * Floating demo panel (bottom right, collapsible). Only rendered on the simulated chain.
	 * Mounted once by the (app) layout. Pages add their own buttons with `useDemoPageActions`.
	 */
	import { onMount } from 'svelte';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Clock from '@lucide/svelte/icons/clock';
	import FastForward from '@lucide/svelte/icons/fast-forward';
	import UserRoundX from '@lucide/svelte/icons/user-round-x';
	import Coins from '@lucide/svelte/icons/coins';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { Button, IconButton, Modal, formatDateTime, formatDuration } from '#lib/ui';
	import { useApp } from './ctx.svelte';
	import { DAY_MS, HOUR_MS, getDemoPageActions, useDemoActions } from './demo.svelte';

	const app = useApp();
	const demo = useDemoActions();
	const uid = $props.id();
	const KEY = 'portunus.demo.open';

	let open = $state(false);
	let confirmReset = $state(false);
	let tick = $state(Date.now());
	let root: HTMLElement | undefined = $state();
	let toggle: HTMLButtonElement | undefined = $state();

	const visible = $derived(app.isSim && app.status?.demoMode !== false);
	const now = $derived(tick + app.clockOffsetMs);
	const offset = $derived(app.clockOffsetMs);
	const extra = $derived(getDemoPageActions());
	const isLine = $derived(app.role === 'line');

	onMount(() => {
		try {
			open = localStorage.getItem(KEY) === '1';
		} catch {
			/* storage blocked */
		}
		const id = setInterval(() => (tick = Date.now()), 1000);
		return () => clearInterval(id);
	});

	function setOpen(v: boolean) {
		open = v;
		try {
			localStorage.setItem(KEY, v ? '1' : '0');
		} catch {
			/* storage blocked */
		}
	}

	function onWindowKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && open && !confirmReset && root?.contains(document.activeElement)) {
			setOpen(false);
			toggle?.focus();
		}
	}
</script>

<svelte:window onkeydown={onWindowKey} />

{#if visible}
	<aside
		class="demo"
		class:open
		aria-label="Demo controls"
		bind:this={root}
		data-testid="demo-controls"
	>
		{#if open}
			<div class="panel" id="demo-panel-{uid}">
				<header class="head">
					<div class="title">
						<SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden="true" />
						<span>Demo controls</span>
					</div>
					<IconButton
						icon={ChevronDown}
						label="Collapse demo controls"
						size="sm"
						onclick={() => {
							setOpen(false);
							toggle?.focus();
						}}
					/>
				</header>

				<div class="clock" aria-live="polite">
					<span class="k"
						><Clock size={12} strokeWidth={1.75} aria-hidden="true" /> Product clock</span
					>
					<span class="now tabular" data-testid="demo-clock"
						>{formatDateTime(now, { seconds: true })}</span
					>
					<span class="off tabular" data-testid="demo-offset">
						{offset > 0
							? `${formatDuration(offset, 'short')} ahead of real time`
							: 'In step with real time'}
					</span>
				</div>

				<div class="group">
					<p class="label">Move time forward</p>
					<div class="pair">
						<Button
							size="sm"
							icon={FastForward}
							loading={demo.busy === 'advance'}
							disabled={demo.busy !== null}
							onclick={() => demo.advanceClock(HOUR_MS)}>+1 hour</Button
						>
						<Button
							size="sm"
							icon={FastForward}
							loading={demo.busy === 'advance'}
							disabled={demo.busy !== null}
							onclick={() => demo.advanceClock(DAY_MS)}>+1 day</Button
						>
					</div>
				</div>

				{#if extra.length}
					<div class="group">
						<p class="label">On this page</p>
						<div class="stack">
							{#each extra as a (a.id)}
								<Button
									size="sm"
									fullWidth
									loading={a.busy}
									disabled={a.disabled || demo.busy !== null}
									onclick={a.onclick}>{a.label}</Button
								>
								{#if a.hint}<p class="hint">{a.hint}</p>{/if}
							{/each}
						</div>
					</div>
				{/if}

				<div class="group">
					<p class="label">Stranger transfer</p>
					<div class="stack">
						<Button
							size="sm"
							fullWidth
							icon={Coins}
							loading={demo.busy === 'stranger'}
							disabled={!isLine || demo.busy !== null}
							onclick={() => demo.sendStranger('BetaUSD')}>Wrong token (BetaUSD)</Button
						>
						<Button
							size="sm"
							fullWidth
							icon={UserRoundX}
							loading={demo.busy === 'stranger'}
							disabled={!isLine || demo.busy !== null}
							onclick={() => demo.sendStranger('AlphaUSD')}>Unknown sender</Button
						>
					</div>
					<p class="hint">
						{isLine
							? 'Sent to this line. The guard holds it under Held transfers.'
							: 'Switch to a shipping line to send one.'}
					</p>
				</div>

				<div class="group last">
					<Button
						size="sm"
						variant="ghost"
						fullWidth
						icon={RotateCcw}
						disabled={demo.busy !== null}
						onclick={() => (confirmReset = true)}>Reset demo data</Button
					>
				</div>
			</div>
		{/if}

		<button
			type="button"
			class="toggle"
			bind:this={toggle}
			aria-expanded={open}
			aria-controls={open ? `demo-panel-${uid}` : undefined}
			onclick={() => setOpen(!open)}
			data-testid="demo-toggle"
		>
			<SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden="true" />
			<span>Demo</span>
			<span class="sep" aria-hidden="true"></span>
			<span class="t tabular">{formatDateTime(now).slice(-5)}</span>
			<span class="sr-only">{open ? 'Collapse' : 'Expand'} demo controls</span>
		</button>
	</aside>

	<Modal
		bind:open={confirmReset}
		size="sm"
		title="Reset demo data?"
		description="All changes are erased, the clock returns to real time and you are signed out. Demo personas come back as new."
		dismissible={demo.busy !== 'reset'}
	>
		{#snippet footer()}
			<Button variant="ghost" onclick={() => (confirmReset = false)}>Cancel</Button>
			<Button
				variant="danger"
				loading={demo.busy === 'reset'}
				onclick={async () => {
					await demo.reset();
					confirmReset = false;
				}}>Reset demo data</Button
			>
		{/snippet}
	</Modal>
{/if}

<style>
	.demo {
		position: fixed;
		right: var(--space-4);
		bottom: var(--space-4);
		z-index: var(--z-dropdown);
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-2);
		max-width: calc(100vw - var(--space-8));
	}

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: 2.25rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		background: var(--color-surface-raised);
		color: var(--color-text-secondary);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		box-shadow: var(--shadow-lg);
		transition:
			border-color var(--duration-fast) var(--ease-standard),
			color var(--duration-fast) var(--ease-standard);
	}

	.toggle:hover {
		border-color: var(--color-border-strong);
		color: var(--color-text);
	}

	.toggle:focus-visible {
		outline: none;
		box-shadow: var(--shadow-lg), var(--color-focus-ring);
	}

	.toggle :global(svg) {
		color: var(--color-accent);
	}

	.sep {
		width: 1px;
		height: 0.875rem;
		background: var(--color-border);
	}

	.panel {
		width: 20rem;
		max-width: 100%;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		background: var(--color-surface-raised);
		box-shadow: var(--shadow-overlay);
		overflow: hidden;
		animation: rise var(--duration-base) var(--ease-out);
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.title {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
	}

	.title :global(svg) {
		color: var(--color-accent);
	}

	.clock {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-4);
		background: var(--color-surface-sunken);
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.k {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-2xs);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--color-text-tertiary);
	}

	.now {
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-snug);
	}

	.off {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}

	.group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.group.last {
		border-bottom: 0;
		padding-block: var(--space-2);
	}

	.label {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-text-secondary);
	}

	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.hint {
		font-size: var(--text-xs);
		line-height: var(--leading-xs);
		color: var(--color-text-tertiary);
	}

	@media (max-width: 767px) {
		.demo {
			right: var(--space-3);
			bottom: var(--space-3);
		}

		.panel {
			width: calc(100vw - var(--space-6));
		}
	}
</style>
