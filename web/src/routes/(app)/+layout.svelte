<script lang="ts">
	/**
	 * Authenticated app shell. Everything under (app)/ renders inside this layout, only after:
	 *   1. the backend is ready (local runtime booted and seeded),
	 *   2. a session exists and `auth.me` resolved to a person,
	 *   3. the person's role may open the current path (otherwise they are sent home).
	 * Pages read the signed-in person with `useApp()` from '#lib/app'.
	 */
	import { onMount, type Snippet } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import {
		AppShell,
		Button,
		DEFAULT_NAV,
		EmptyState,
		type LiveState,
		type NavSection,
		type Org,
		type Role
	} from '#lib/ui';
	import {
		backendMode,
		backendStatus,
		clearSession,
		getBackend,
		resetLocalDb,
		session,
		useAuthedQuery
	} from '#lib/backend';
	import {
		ApproveSheet,
		AppLoading,
		DemoControls,
		api,
		canOpen,
		createApp,
		setApp
	} from '#lib/app';
	import ChainBadge from '#lib/app/ChainBadge.svelte';
	import NotificationsMenu from '#lib/app/NotificationsMenu.svelte';
	import UserMenu from '#lib/app/UserMenu.svelte';

	let { children }: { children: Snippet } = $props();

	const app = createApp();
	setApp(app);

	const token = $derived(session.token);
	const me = $derived(app.meState);
	const path = $derived(page.url.pathname);

	type Gate = 'loading' | 'startup-error' | 'load-error' | 'anon' | 'redirect' | 'ok';
	const gate: Gate = $derived.by(() => {
		if (!backendStatus.ready) return 'loading';
		if (backendStatus.error) return 'startup-error';
		if (!token) return 'anon';
		if (me.error) return 'load-error';
		if (me.data === null) return 'anon';
		if (me.data === undefined) return 'loading';
		return canOpen(app.role, path) ? 'ok' : 'redirect';
	});

	$effect(() => {
		if (gate === 'anon') {
			// Signing out (or resetting the demo) navigates by itself; do not race it.
			if (app.signingOut) return;
			// A token that auth.me rejects is stale: drop it.
			if (token && me.data === null) clearSession();
			const next = `${page.url.pathname}${page.url.search}`;
			const to = next === '/' ? '/signin' : `/signin?next=${encodeURIComponent(next)}`;
			void goto(to, { replace: true });
		} else if (gate === 'redirect') {
			void goto(app.home, { replace: true });
		}
	});

	// ---- live indicator -------------------------------------------------------------------
	let online = $state(true);
	let socket = $state(true);
	onMount(() => {
		online = navigator.onLine;
		const on = () => (online = true);
		const off = () => (online = false);
		window.addEventListener('online', on);
		window.addEventListener('offline', off);
		let timer: ReturnType<typeof setInterval> | undefined;
		if (backendMode === 'convex') {
			timer = setInterval(() => {
				try {
					const b = getBackend() as unknown as {
						connectionState?: () => { isWebSocketConnected: boolean };
					};
					socket = b.connectionState ? b.connectionState().isWebSocketConnected : true;
				} catch {
					socket = true;
				}
			}, 3000);
		}
		return () => {
			window.removeEventListener('online', on);
			window.removeEventListener('offline', off);
			clearInterval(timer);
		};
	});
	const live: LiveState = $derived(!online ? 'offline' : !socket ? 'connecting' : 'live');

	// ---- nav with counts --------------------------------------------------------------------
	const openDisputes = useAuthedQuery(api.disputes.list, () =>
		gate === 'ok' ? { status: 'open' as const } : 'skip'
	);
	const heldTransfers = useAuthedQuery(api.heldTransfers.list, () =>
		gate === 'ok' && app.role === 'line' ? { status: 'held' as const } : 'skip'
	);

	const nav: NavSection[] = $derived.by(() => {
		const disputes = openDisputes.data?.length ?? 0;
		const held = heldTransfers.data?.length ?? 0;
		return DEFAULT_NAV[app.role].map((section) => ({
			...section,
			items: section.items.map((item) =>
				item.href === '/disputes'
					? { ...item, badge: disputes || undefined }
					: item.href === '/line/held'
						? { ...item, badge: held || undefined }
						: item
			)
		}));
	});

	// ---- org / persona switcher (demo) ---------------------------------------------------
	const shellOrg: Org = $derived({
		id: app.isDemo ? app.user._id : app.org._id,
		name: app.org.name,
		role: app.role,
		location: app.user.name
	});
	const shellOrgs: Org[] = $derived(
		app.isDemo
			? app.personas
					.filter((p) => p.orgKind !== 'platform')
					.map((p) => ({
						id: p.userId,
						name: p.orgName,
						role: p.orgKind as Role,
						location: p.name
					}))
			: []
	);
	const canSwitchRole = $derived(
		app.isDemo && ['line', 'importer'].every((r) => app.personas.some((p) => p.orgKind === r))
	);
</script>

{#if gate === 'ok'}
	<AppShell
		role={app.role}
		onRoleChange={canSwitchRole ? (r) => void app.switchRole(r) : undefined}
		org={shellOrg}
		orgs={shellOrgs}
		onOrgChange={(o) => void app.switchPersona(o.id)}
		path={page.url.pathname}
		{nav}
		{live}
		homeHref={app.home}
	>
		{#snippet network()}
			<ChainBadge />
		{/snippet}
		{#snippet topbarEnd()}
			<NotificationsMenu />
			<UserMenu />
		{/snippet}
		{@render children()}
	</AppShell>
	<ApproveSheet />
	<DemoControls />
{:else if gate === 'startup-error'}
	<div class="center">
		<EmptyState
			tone="error"
			title="The app could not start"
			description={backendStatus.error ?? 'The in-browser data store failed to load.'}
		>
			{#snippet actions()}
				<Button variant="primary" onclick={() => location.reload()}>Reload</Button>
				{#if backendMode === 'local'}
					<Button
						variant="secondary"
						onclick={async () => {
							await resetLocalDb();
							location.reload();
						}}>Reset local data</Button
					>
				{/if}
			{/snippet}
		</EmptyState>
	</div>
{:else if gate === 'load-error'}
	<div class="center">
		<EmptyState
			tone="error"
			title="Could not load your account"
			description="Check your connection and try again."
		>
			{#snippet actions()}
				<Button variant="primary" onclick={() => location.reload()}>Reload</Button>
				<Button
					variant="secondary"
					onclick={() => {
						clearSession();
					}}>Sign in again</Button
				>
			{/snippet}
		</EmptyState>
	</div>
{:else}
	<AppLoading />
{/if}

<style>
	.center {
		display: grid;
		place-items: center;
		min-height: 100dvh;
		padding: var(--space-6);
	}
</style>
