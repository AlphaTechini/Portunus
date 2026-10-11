<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import Check from '@lucide/svelte/icons/check';
	import Menu from '@lucide/svelte/icons/menu';
	import X from '@lucide/svelte/icons/x';
	import Logo from './Logo.svelte';
	import SegmentedControl from './SegmentedControl.svelte';
	import LiveIndicator from './LiveIndicator.svelte';
	import NetworkBadge from './NetworkBadge.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import { DEFAULT_NAV, ROLE_LABEL, isActive } from './nav';
	import type { LiveState, NavSection, Org, Role, SwitchableRole } from './types';

	interface Props {
		/** Current role. Drives the default nav and the role switcher. */
		role: Role;
		/** Demo role switch (Line vs Importer). Omit to hide the switcher. */
		onRoleChange?: (role: SwitchableRole) => void;
		/** Active organization. */
		org: Org;
		/** Organizations the user can switch between. */
		orgs?: Org[];
		onOrgChange?: (org: Org) => void;
		/** Current pathname, e.g. page.url.pathname. */
		path: string;
		/** Override the default nav for the role. */
		nav?: NavSection[];
		live?: LiveState;
		user?: { name: string; email?: string };
		/** Logo link target. */
		homeHref?: string;
		/**
		 * The one network indicator. Replaces the default `NetworkBadge` (e.g. a badge that also says
		 * whether the chain is simulated). Rendered in the top bar and in the mobile menu.
		 */
		network?: Snippet;
		/** Extra items at the right end of the top bar (after the theme toggle), e.g. notifications and the user menu. */
		topbarEnd?: Snippet;
		children: Snippet;
	}

	let {
		role,
		onRoleChange,
		org,
		orgs = [],
		onOrgChange,
		path,
		nav,
		live = 'live',
		user,
		homeHref = '/',
		network,
		topbarEnd,
		children
	}: Props = $props();

	const sections = $derived(nav ?? DEFAULT_NAV[role]);
	const uid = $props.id();
	let menuOpen = $state(false);
	let orgButton: HTMLButtonElement | undefined = $state();
	let orgPop: HTMLElement | undefined = $state();
	let roleValue = $derived<Role>(role);

	// close the mobile menu when the route changes
	$effect(() => {
		void path;
		menuOpen = false;
	});

	function initials(name: string) {
		return name
			.split(/\s+/)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.join('');
	}

	function placeOrgPop(e: Event) {
		const ev = e as ToggleEvent;
		if (ev.newState !== 'open' || !orgButton || !orgPop) return;
		const r = orgButton.getBoundingClientRect();
		orgPop.style.top = `${r.bottom + 6}px`;
		orgPop.style.left = `${Math.max(8, r.left)}px`;
		orgPop.style.minWidth = `${Math.max(r.width, 260)}px`;
		orgPop.querySelector<HTMLElement>('[aria-current="true"], button')?.focus();
	}

	function pickOrg(o: Org) {
		orgPop?.hidePopover();
		onOrgChange?.(o);
	}

	function onWindowKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && menuOpen) menuOpen = false;
	}
</script>

<svelte:window onkeydown={onWindowKey} />

{#snippet navList(compactLabels: boolean)}
	{#each sections as section, si (si)}
		<div class="nav-section">
			{#if section.label}<p class="nav-label">{section.label}</p>{/if}
			<ul>
				{#each section.items as item (item.href)}
					{@const active = isActive(item.href, path, item.matchPrefix ?? true)}
					<li>
						<a
							href={item.href}
							class="nav-item"
							class:active
							aria-current={active ? 'page' : undefined}
							data-label={compactLabels ? item.label : undefined}
						>
							<item.icon size={16} strokeWidth={1.75} aria-hidden="true" />
							<span class="nav-text">{item.label}</span>
							{#if item.badge}<span class="nav-badge tabular">{item.badge}</span>{/if}
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{/each}
{/snippet}

{#snippet roleSwitch(full: boolean)}
	{#if onRoleChange}
		<div class="role-switch" class:full>
			<span class="role-k" id="role-{uid}">Demo view</span>
			<SegmentedControl
				label="Demo view: switch role"
				size="sm"
				fullWidth={full}
				options={[
					{ value: 'line', label: 'Line' },
					{ value: 'importer', label: 'Importer' }
				]}
				bind:value={roleValue}
				onchange={(v) => onRoleChange?.(v as SwitchableRole)}
			/>
		</div>
	{/if}
{/snippet}

{#snippet orgSwitch()}
	<button
		bind:this={orgButton}
		type="button"
		class="org"
		popovertarget="org-{uid}"
		aria-haspopup="menu"
		disabled={orgs.length < 2}
	>
		<span class="org-avatar role-{org.role}" aria-hidden="true">{initials(org.name)}</span>
		<span class="org-text">
			<span class="org-name">{org.name}</span>
			<span class="org-role">{ROLE_LABEL[org.role]}{org.location ? `, ${org.location}` : ''}</span>
		</span>
		{#if orgs.length > 1}<ChevronsUpDown
				size={14}
				strokeWidth={1.75}
				aria-hidden="true"
				class="org-chev"
			/>{/if}
	</button>
{/snippet}

<div class="shell">
	<a href="#main" class="skip-link">Skip to content</a>

	<aside class="sidebar">
		<div class="brand">
			<a href={homeHref} class="brand-link" aria-label="Portunus home">
				<span class="brand-full"><Logo size={22} label="" /></span>
				<span class="brand-mark"><Logo variant="mark" size={24} label="" /></span>
			</a>
		</div>
		<nav class="nav" aria-label="Main">
			{@render navList(true)}
		</nav>
		<div class="side-foot">
			<div class="fee-note">
				<span class="fee-dot" aria-hidden="true"></span>
				<span>Network fees sponsored by Portunus</span>
			</div>
		</div>
	</aside>

	<div class="column">
		<header class="topbar">
			<div class="tb-left">
				<a href={homeHref} class="mobile-brand" aria-label="Portunus home"
					><Logo size={22} label="" /></a
				>
				<div class="org-slot">{@render orgSwitch()}</div>
			</div>
			<div class="tb-right">
				<div class="hide-mobile">{@render roleSwitch(false)}</div>
				<span class="divider hide-mobile" aria-hidden="true"></span>
				<LiveIndicator state={live} />
				{#if network}{@render network()}{:else}<span class="hide-tablet"><NetworkBadge /></span
					>{/if}
				<span class="hide-mobile"><ThemeToggle /></span>
				{#if topbarEnd}{@render topbarEnd()}{/if}
				{#if user}
					<span
						class="user hide-mobile"
						title={user.email ?? user.name}
						aria-label="Signed in as {user.name}"
						role="img"
					>
						{initials(user.name)}
					</span>
				{/if}
				<button
					type="button"
					class="menu-btn"
					aria-expanded={menuOpen}
					aria-controls="mobile-menu-{uid}"
					aria-label={menuOpen ? 'Close menu' : 'Open menu'}
					onclick={() => (menuOpen = !menuOpen)}
				>
					{#if menuOpen}<X size={18} strokeWidth={1.75} aria-hidden="true" />{:else}<Menu
							size={18}
							strokeWidth={1.75}
							aria-hidden="true"
						/>{/if}
				</button>
			</div>
		</header>

		{#if menuOpen}
			<div class="mobile-menu" id="mobile-menu-{uid}">
				<nav aria-label="Main">{@render navList(false)}</nav>
				<div class="mm-foot">
					{#if orgs.length > 1}
						<div class="nav-section">
							<p class="nav-label">Organization</p>
							<ul>
								{#each orgs as o (o.id)}
									<li>
										<button
											type="button"
											class="pop-item"
											aria-current={o.id === org.id ? 'true' : undefined}
											onclick={() => onOrgChange?.(o)}
										>
											<span class="org-avatar sm role-{o.role}" aria-hidden="true"
												>{initials(o.name)}</span
											>
											<span class="org-text">
												<span class="org-name">{o.name}</span>
												<span class="org-role">{ROLE_LABEL[o.role]}</span>
											</span>
											{#if o.id === org.id}<Check
													size={14}
													strokeWidth={2}
													aria-hidden="true"
												/>{/if}
										</button>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
					{@render roleSwitch(true)}
					<div class="mm-row">
						{#if network}{@render network()}{:else}<NetworkBadge />{/if}
						<ThemeToggle />
					</div>
				</div>
			</div>
		{/if}

		<main id="main" class="content" tabindex="-1">
			{@render children()}
		</main>
	</div>
</div>

<div
	bind:this={orgPop}
	id="org-{uid}"
	popover="auto"
	class="org-pop"
	role="menu"
	aria-label="Switch organization"
	ontoggle={placeOrgPop}
>
	<p class="pop-label">Organizations</p>
	{#each orgs as o (o.id)}
		<button
			type="button"
			role="menuitem"
			class="pop-item"
			aria-current={o.id === org.id ? 'true' : undefined}
			onclick={() => pickOrg(o)}
		>
			<span class="org-avatar sm role-{o.role}" aria-hidden="true">{initials(o.name)}</span>
			<span class="org-text">
				<span class="org-name">{o.name}</span>
				<span class="org-role">{ROLE_LABEL[o.role]}{o.location ? `, ${o.location}` : ''}</span>
			</span>
			{#if o.id === org.id}<Check size={14} strokeWidth={2} aria-hidden="true" />{/if}
		</button>
	{/each}
</div>

<style>
	.shell {
		display: grid;
		grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
		min-height: 100dvh;
		background: var(--color-bg);
	}

	/* ---------- sidebar ---------- */
	.sidebar {
		position: sticky;
		top: 0;
		height: 100dvh;
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--color-border);
		background: var(--color-bg);
		z-index: var(--z-nav);
	}

	.brand {
		display: flex;
		align-items: center;
		height: var(--topbar-height);
		padding: 0 var(--space-5);
	}

	.brand-link {
		display: inline-flex;
		border-radius: var(--radius-sm);
		color: inherit;
	}

	.brand-link:hover {
		text-decoration: none;
	}

	.brand-mark {
		display: none;
	}

	.nav {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-3) var(--space-3);
	}

	.nav-section + .nav-section {
		margin-top: var(--space-5);
	}

	.nav-label {
		padding: 0 var(--space-3) var(--space-1-5);
		font-size: var(--text-2xs);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--color-text-tertiary);
	}

	.nav ul,
	.mobile-menu ul {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.nav-item {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--space-2-5);
		height: 2rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		transition:
			background-color var(--duration-fast) var(--ease-standard),
			color var(--duration-fast) var(--ease-standard);
	}

	.nav-item :global(svg) {
		color: var(--color-text-tertiary);
		transition: color var(--duration-fast) var(--ease-standard);
	}

	.nav-item:hover {
		text-decoration: none;
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.nav-item.active {
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow:
			var(--shadow-xs),
			0 0 0 1px var(--color-border);
	}

	.nav-item.active :global(svg) {
		color: var(--color-accent);
	}

	.nav-item:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
	}

	.nav-text {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.nav-badge {
		min-width: 1.25rem;
		height: 1.125rem;
		padding: 0 5px;
		border-radius: var(--radius-full);
		background: var(--tone-danger-bg);
		color: var(--tone-danger-fg);
		font-size: var(--text-2xs);
		font-weight: var(--weight-semibold);
		line-height: 1.125rem;
		text-align: center;
	}

	.side-foot {
		padding: var(--space-4) var(--space-5) var(--space-5);
	}

	/* Room for the docked demo controls pill (DemoControls sets the attribute while it is shown). */
	:global(html[data-demo-controls]) .side-foot {
		padding-bottom: calc(var(--space-3) + 2.25rem + var(--space-4));
	}

	.fee-note {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.fee-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-accent);
		flex-shrink: 0;
		/* centre on the first line when the note wraps */
		margin-top: calc((var(--leading-xs) - 6px) / 2);
	}

	/* ---------- column / topbar ---------- */
	.column {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.topbar {
		position: sticky;
		top: 0;
		z-index: var(--z-sticky);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		height: var(--topbar-height);
		padding: 0 var(--space-6);
		border-bottom: 1px solid var(--color-border);
		background: color-mix(in srgb, var(--color-bg) 88%, transparent);
		backdrop-filter: saturate(1.4) blur(10px);
		-webkit-backdrop-filter: saturate(1.4) blur(10px);
	}

	.tb-left,
	.tb-right {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}

	.mobile-brand {
		display: none;
		color: inherit;
	}

	.divider {
		width: 1px;
		height: 1.25rem;
		background: var(--color-border);
	}

	.role-switch {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.role-switch.full {
		display: flex;
		flex-direction: column;
		align-items: stretch;
	}

	.role-k {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
		white-space: nowrap;
	}

	.user {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 50%;
		background: var(--color-surface-active);
		color: var(--color-text-secondary);
		font-size: var(--text-2xs);
		font-weight: var(--weight-semibold);
	}

	.menu-btn {
		display: none;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
	}

	.menu-btn:hover {
		background: var(--color-surface-hover);
	}

	.menu-btn:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
	}

	/* ---------- org switcher ---------- */
	.org {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2-5);
		min-width: 0;
		max-width: 20rem;
		height: 2.25rem;
		padding: 0 var(--space-2) 0 var(--space-1);
		border-radius: var(--radius-md);
		text-align: left;
		transition: background-color var(--duration-fast) var(--ease-standard);
	}

	.org:hover:not(:disabled) {
		background: var(--color-surface-hover);
	}

	.org:disabled {
		cursor: default;
	}

	.org:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
	}

	.org-avatar {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: var(--radius-sm);
		font-size: var(--text-2xs);
		font-weight: var(--weight-bold);
		letter-spacing: 0.02em;
		flex-shrink: 0;
	}

	.org-avatar.sm {
		width: 1.5rem;
		height: 1.5rem;
	}

	.org-avatar.role-line {
		background: var(--color-primary);
		color: var(--color-primary-fg);
	}

	.org-avatar.role-importer {
		background: var(--color-accent-muted);
		color: var(--color-accent-text);
	}

	.org-avatar.role-platform {
		background: var(--color-surface-active);
		color: var(--color-text);
	}

	.org-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}

	.org-name {
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		line-height: 1.1rem;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.org-role {
		font-size: var(--text-2xs);
		line-height: 0.9rem;
		color: var(--color-text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.org :global(.org-chev) {
		color: var(--color-text-tertiary);
	}

	.org-pop {
		position: fixed;
		inset: auto;
		margin: 0;
		padding: var(--space-1-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface-raised);
		box-shadow: var(--shadow-overlay);
		color: var(--color-text);
	}

	.pop-label {
		padding: var(--space-1-5) var(--space-2) var(--space-1);
		font-size: var(--text-2xs);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--color-text-tertiary);
	}

	.pop-item {
		display: flex;
		align-items: center;
		gap: var(--space-2-5);
		width: 100%;
		padding: var(--space-1-5) var(--space-2);
		border-radius: var(--radius-md);
		text-align: left;
	}

	.pop-item:hover,
	.pop-item:focus-visible {
		outline: none;
		background: var(--color-surface-hover);
	}

	.pop-item :global(svg) {
		color: var(--color-accent);
	}

	/* ---------- content ---------- */
	.content {
		flex: 1;
		width: 100%;
		max-width: calc(var(--content-max) + var(--space-8) * 2);
		margin: 0 auto;
		padding: var(--space-8) var(--space-8) var(--space-16);
	}

	.content:focus {
		outline: none;
	}

	/* ---------- mobile menu ---------- */
	.mobile-menu {
		position: sticky;
		top: var(--topbar-height);
		z-index: var(--z-nav);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-height: calc(100dvh - var(--topbar-height));
		overflow-y: auto;
		padding: var(--space-4);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg);
		box-shadow: var(--shadow-lg);
		animation: drop var(--duration-base) var(--ease-out);
	}

	.mobile-menu .nav-item {
		height: 2.5rem;
		font-size: var(--text-base);
	}

	.mm-foot {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}

	.mm-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	@keyframes drop {
		from {
			opacity: 0;
			transform: translateY(-6px);
		}
	}

	/* ---------- tablet: icon rail ---------- */
	@media (max-width: 1023px) {
		.shell {
			grid-template-columns: var(--sidebar-rail-width) minmax(0, 1fr);
		}

		.brand {
			justify-content: center;
			padding: 0;
		}

		.brand-full {
			display: none;
		}

		.brand-mark {
			display: inline-flex;
		}

		.nav {
			padding: var(--space-3) var(--space-2-5);
		}

		.nav .nav-label {
			height: 1px;
			margin: var(--space-2) var(--space-2);
			padding: 0;
			overflow: hidden;
			color: transparent;
			background: var(--color-border);
		}

		.nav .nav-item {
			justify-content: center;
			padding: 0;
			height: 2.5rem;
		}

		.nav .nav-text {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
		}

		.nav .nav-badge {
			position: absolute;
			top: 2px;
			right: 2px;
			min-width: 1rem;
			height: 1rem;
			line-height: 1rem;
			padding: 0 3px;
		}

		.nav .nav-item[data-label]:hover::after,
		.nav .nav-item[data-label]:focus-visible::after {
			content: attr(data-label);
			position: absolute;
			left: calc(100% + 10px);
			top: 50%;
			transform: translateY(-50%);
			padding: var(--space-1) var(--space-2);
			border-radius: var(--radius-sm);
			background: var(--color-surface-inverse);
			color: var(--color-text-inverse);
			font-size: var(--text-xs);
			white-space: nowrap;
			pointer-events: none;
			box-shadow: var(--shadow-md);
		}

		.side-foot {
			display: none;
		}

		.hide-tablet {
			display: none;
		}

		.topbar {
			padding: 0 var(--space-5);
		}

		.content {
			padding: var(--space-6) var(--space-6) var(--space-12);
		}
	}

	/* ---------- mobile: top menu ---------- */
	@media (max-width: 767px) {
		.shell {
			grid-template-columns: minmax(0, 1fr);
		}

		.sidebar {
			display: none;
		}

		.topbar {
			padding: 0 var(--space-4);
		}

		.mobile-brand {
			display: inline-flex;
		}

		.org-slot,
		.hide-mobile {
			display: none;
		}

		.menu-btn {
			display: inline-grid;
		}

		.content {
			/* bottom room so the floating demo button never covers the last row */
			padding: var(--space-5) var(--space-4) var(--space-20);
		}
	}

	@media (min-width: 768px) {
		.mobile-menu {
			display: none;
		}
	}
</style>
