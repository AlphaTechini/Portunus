<script lang="ts">
	/** Avatar button with a popover: who is signed in, how, and Sign out. Used by the (app) top bar. */
	import LogOut from '@lucide/svelte/icons/log-out';
	import { Badge, Button } from '#lib/ui';
	import { useApp } from './ctx.svelte';

	const app = useApp();
	const uid = $props.id();
	let button: HTMLButtonElement | undefined = $state();
	let pop: HTMLElement | undefined = $state();
	let signingOut = $state(false);

	const initials = $derived(
		app.user.name
			.split(/\s+/)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.join('')
	);

	function place(e: Event) {
		const ev = e as ToggleEvent;
		if (ev.newState !== 'open' || !button || !pop) return;
		const r = button.getBoundingClientRect();
		pop.style.top = `${r.bottom + 6}px`;
		pop.style.left = `${Math.max(8, Math.min(r.right - 264, window.innerWidth - 272))}px`;
		pop.querySelector<HTMLElement>('button')?.focus();
	}

	async function signOut() {
		signingOut = true;
		try {
			await app.signOut();
		} finally {
			signingOut = false;
		}
	}
</script>

<button
	bind:this={button}
	type="button"
	class="avatar"
	popovertarget="user-{uid}"
	aria-haspopup="dialog"
	aria-label="Account: {app.user.name}"
	data-testid="user-menu-button"
>
	{initials}
</button>

<div
	bind:this={pop}
	id="user-{uid}"
	popover="auto"
	class="pop"
	role="dialog"
	aria-label="Account"
	ontoggle={place}
>
	<div class="who">
		<span class="name" data-testid="user-name">{app.user.name}</span>
		{#if app.user.title}<span class="sub">{app.user.title}</span>{/if}
		<span class="sub">{app.org.name}</span>
		{#if app.user.email}<span class="sub mono">{app.user.email}</span>{/if}
	</div>
	<div class="how">
		{#if app.isDemo}
			<Badge size="sm" tone="neutral">Demo persona</Badge>
		{:else}
			<Badge size="sm" tone="protocol" dot>Signed in with passkey</Badge>
		{/if}
	</div>
	<div class="foot">
		<Button
			fullWidth
			variant="secondary"
			icon={LogOut}
			loading={signingOut}
			onclick={signOut}
			data-testid="sign-out">Sign out</Button
		>
	</div>
</div>

<style>
	.avatar {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 50%;
		background: var(--color-surface-active);
		color: var(--color-text-secondary);
		font-size: var(--text-2xs);
		font-weight: var(--weight-semibold);
		transition: box-shadow var(--duration-fast) var(--ease-standard);
	}

	.avatar:hover {
		box-shadow: 0 0 0 2px var(--color-border-strong);
	}

	.avatar:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
	}

	.pop {
		position: fixed;
		inset: auto;
		margin: 0;
		width: 16.5rem;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface-raised);
		color: var(--color-text);
		box-shadow: var(--shadow-overlay);
	}

	.who {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-4) var(--space-4) var(--space-3);
	}

	.name {
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
	}

	.sub {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
		overflow-wrap: anywhere;
	}

	.how {
		padding: 0 var(--space-4) var(--space-3);
	}

	.foot {
		padding: var(--space-3) var(--space-4) var(--space-4);
		border-top: 1px solid var(--color-border-subtle);
	}
</style>
