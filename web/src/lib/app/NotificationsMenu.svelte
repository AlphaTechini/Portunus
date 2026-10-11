<script lang="ts">
	/** Bell with an unread count and a dropdown of the latest notifications. Used by the (app) top bar. */
	import Bell from '@lucide/svelte/icons/bell';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import { goto } from '$app/navigation';
	import { Button, Skeleton, EmptyState, formatRelative } from '#lib/ui';
	import { getBackend, session, useAuthedMutation, useAuthedQuery } from '#lib/backend';
	import { api } from './api';
	import { useApp } from './ctx.svelte';
	import { containerHref } from './routes';
	import { errorMessage } from './errors';

	const app = useApp();
	const uid = $props.id();
	const list = useAuthedQuery(api.notifications.list, { limit: 20 });
	const markRead = useAuthedMutation(api.notifications.markRead);

	let button: HTMLButtonElement | undefined = $state();
	let pop: HTMLElement | undefined = $state();
	let failure = $state('');

	const unread = $derived(list.data?.unread ?? 0);
	const items = $derived(list.data?.items ?? []);

	function place(e: Event) {
		const ev = e as ToggleEvent;
		if (ev.newState !== 'open' || !button || !pop) return;
		const r = button.getBoundingClientRect();
		const w = Math.min(380, window.innerWidth - 16);
		pop.style.width = `${w}px`;
		pop.style.top = `${r.bottom + 6}px`;
		pop.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
		pop.querySelector<HTMLElement>('button')?.focus();
	}

	async function readAll() {
		failure = '';
		try {
			await markRead({});
		} catch (e) {
			failure = errorMessage(e);
		}
	}

	async function open(n: (typeof items)[number]) {
		pop?.hidePopover();
		try {
			if (n.readAt === undefined) await markRead({ ids: [n._id] });
			if (n.containerId) {
				const r = await getBackend().query(api.containers.get, {
					sessionToken: session.token ?? '',
					containerId: n.containerId
				});
				await goto(containerHref(r.container.number));
			}
		} catch {
			/* navigation is best effort */
		}
	}
</script>

<button
	bind:this={button}
	type="button"
	class="bell"
	popovertarget="notes-{uid}"
	aria-haspopup="dialog"
	aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
	data-testid="notifications-button"
>
	<Bell size={16} strokeWidth={1.75} aria-hidden="true" />
	{#if unread > 0}<span class="count tabular" aria-hidden="true">{unread > 9 ? '9+' : unread}</span
		>{/if}
</button>

<div
	bind:this={pop}
	id="notes-{uid}"
	popover="auto"
	class="pop"
	role="dialog"
	aria-label="Notifications"
	ontoggle={place}
>
	<header class="head">
		<h2>Notifications</h2>
		<Button size="sm" variant="ghost" icon={CheckCheck} disabled={unread === 0} onclick={readAll}
			>Mark all read</Button
		>
	</header>
	{#if failure}<p class="failure" role="alert">{failure}</p>{/if}
	<div class="body">
		{#if list.isLoading}
			<div class="loading">
				<Skeleton lines={2} />
				<Skeleton lines={2} />
				<Skeleton lines={2} />
			</div>
		{:else if list.error}
			<EmptyState
				compact
				tone="error"
				title="Could not load notifications"
				description="Check your connection and try again."
			/>
		{:else if items.length === 0}
			<EmptyState
				compact
				icon={Bell}
				title="You are all caught up"
				description="Deposits, returns and refunds will show up here."
			/>
		{:else}
			<ul>
				{#each items as n (n._id)}
					<li>
						<button
							type="button"
							class="item"
							class:unread={n.readAt === undefined}
							onclick={() => open(n)}
						>
							<span class="dot" aria-hidden="true"></span>
							<span class="txt">
								<span class="t">{n.title}</span>
								<span class="b">{n.body}</span>
								<span class="when tabular">{formatRelative(n.createdAt, app.now())}</span>
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.bell {
		position: relative;
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		transition: background-color var(--duration-fast) var(--ease-standard);
	}

	.bell:hover {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.bell:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
	}

	.count {
		position: absolute;
		top: 3px;
		right: 2px;
		min-width: 1rem;
		height: 1rem;
		padding: 0 4px;
		border-radius: var(--radius-full);
		background: var(--color-accent);
		color: var(--color-accent-fg);
		font-size: 10px;
		font-weight: var(--weight-semibold);
		line-height: 1rem;
		text-align: center;
		box-shadow: 0 0 0 2px var(--color-bg);
	}

	.pop {
		position: fixed;
		inset: auto;
		margin: 0;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface-raised);
		color: var(--color-text);
		box-shadow: var(--shadow-overlay);
		overflow: hidden;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
		border-bottom: 1px solid var(--color-border-subtle);
	}

	h2 {
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
	}

	.body {
		max-height: min(26rem, 70dvh);
		overflow-y: auto;
	}

	.loading {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4);
	}

	.failure {
		padding: var(--space-2) var(--space-4);
		font-size: var(--text-xs);
		color: var(--tone-danger-fg);
	}

	li + li {
		border-top: 1px solid var(--color-border-subtle);
	}

	.item {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-3) var(--space-4);
		text-align: left;
	}

	.item:hover,
	.item:focus-visible {
		outline: none;
		background: var(--color-surface-hover);
	}

	.dot {
		width: 7px;
		height: 7px;
		margin-top: 6px;
		border-radius: 50%;
		background: transparent;
		flex-shrink: 0;
	}

	.unread .dot {
		background: var(--color-accent);
	}

	.txt {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.t {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text);
	}

	.item:not(.unread) .t {
		font-weight: var(--weight-regular);
		color: var(--color-text-secondary);
	}

	.b {
		font-size: var(--text-xs);
		line-height: var(--leading-xs);
		color: var(--color-text-secondary);
	}

	.when {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}
</style>
