<script lang="ts">
	/**
	 * Sign in (docs/design/DESIGN.md section 11.2).
	 *  - Passkey sign-in: auth.createChallenge -> getPasskeyAssertion -> auth.signInWithPasskey.
	 *  - Create an account: createPasskey -> auth.registerPasskey.
	 *  - Demo personas: auth.listDemoPersonas -> auth.signInAsDemo (one click).
	 * Respects `?next=/some/path` (same-origin app paths the role may open).
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import {
		Badge,
		EmptyState,
		Field,
		Input,
		Logo,
		NetworkBadge,
		PasskeyButton,
		SegmentedControl,
		Select,
		Skeleton,
		Spinner,
		TempoTag,
		ThemeToggle,
		toast
	} from '#lib/ui';
	import { backendStatus, getBackend, session, setSession, useQuery } from '#lib/backend';
	import {
		api,
		errorMessage,
		liveFaucet,
		rememberPersona,
		safeNext,
		type AppRole,
		type DemoPersona
	} from '#lib/app';
	import {
		createPasskey,
		getPasskeyAssertion,
		isPasskeySupported,
		passkeyRpId,
		PasskeyError
	} from '#lib/tempo/passkey';

	const next = $derived(page.url.searchParams.get('next'));

	type Phase = 'idle' | 'waiting' | 'success' | 'error';
	let signInPhase = $state<Phase>('idle');
	let signInError = $state('');
	let createOpen = $state(false);
	let createPhase = $state<Phase>('idle');
	let createError = $state('');
	let personaBusy = $state<string | null>(null);
	let personaError = $state('');
	let unsupported = $state('');
	let checked = $state(false);

	let name = $state('');
	let orgName = $state('');
	let orgKind = $state<'line' | 'importer'>('importer');
	let country = $state('Nigeria');
	let touched = $state(false);

	const COUNTRIES = [
		'Nigeria',
		'Kenya',
		'Tanzania',
		'Philippines',
		'Pakistan',
		'India',
		'United States',
		'Other'
	].map((c) => ({ value: c, label: c }));

	const busy = $derived(
		signInPhase === 'waiting' || createPhase === 'waiting' || personaBusy !== null
	);
	const nameError = $derived(touched && !name.trim() ? 'Enter your name.' : '');
	const orgError = $derived(touched && !orgName.trim() ? 'Enter your organization.' : '');

	// ---- already signed in? go straight to the app ---------------------------------------
	const me = useQuery(api.auth.me, () =>
		session.token ? { sessionToken: session.token } : 'skip'
	);
	$effect(() => {
		if (me.data && signInPhase !== 'success' && createPhase !== 'success' && !personaBusy) {
			void goto(safeNext(next, me.data.user.role as AppRole), { replace: true });
		}
	});

	// ---- demo personas -----------------------------------------------------------------------
	const personasQ = useQuery(api.auth.listDemoPersonas, {});
	const statusQ = useQuery(api.system.status, {});
	const groups = $derived.by(() => {
		const all = personasQ.data ?? [];
		return [
			{ kind: 'line', label: 'Shipping lines', items: all.filter((p) => p.orgKind === 'line') },
			{
				kind: 'importer',
				label: 'Importers and clearing agents',
				items: all.filter((p) => p.orgKind === 'importer')
			},
			{
				kind: 'platform',
				label: 'Platform',
				items: all.filter((p) => p.orgKind === 'platform')
			}
		].filter((g) => g.items.length);
	});

	onMount(() => {
		// Tell the person early if this browser or address cannot do passkeys at all.
		try {
			if (!isPasskeySupported()) {
				unsupported =
					'This browser or device does not support passkeys. Try a current version of Chrome, Safari or Edge.';
			} else {
				passkeyRpId();
			}
		} catch (e) {
			unsupported = e instanceof PasskeyError ? e.message : errorMessage(e);
		}
		checked = true;
	});

	function initials(n: string) {
		return n
			.split(/\s+/)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.join('');
	}

	async function land(token: string, remember?: { role: AppRole; userId: string }) {
		setSession(token);
		const meNow = await getBackend().query(api.auth.me, { sessionToken: token });
		const role = (meNow?.user.role ?? remember?.role ?? 'importer') as AppRole;
		if (remember) rememberPersona(role, remember.userId);
		await goto(safeNext(next, role), { replace: true });
	}

	function passkeyMessage(e: unknown, fallback: string): string {
		if (e instanceof PasskeyError && e.code === 'CANCELLED') {
			return 'Not completed. Approve the prompt on your device to continue.';
		}
		return errorMessage(e, fallback);
	}

	async function signInWithPasskey() {
		if (busy) return;
		signInPhase = 'waiting';
		signInError = '';
		try {
			const backend = getBackend();
			await backend.ready;
			const { challenge } = await backend.mutation(api.auth.createChallenge, {});
			const sig = await getPasskeyAssertion(challenge, {
				getPublicKey: async (credentialId: string) =>
					(await backend.query(api.auth.passkeyPublicKey, { credentialId })) as `0x${string}` | null
			});
			const res = await backend.mutation(api.auth.signInWithPasskey, {
				credentialId: sig.credentialId,
				challenge: sig.challenge,
				authenticatorData: sig.metadata.authenticatorData,
				clientDataJSON: sig.metadata.clientDataJSON,
				signatureR: sig.signature.r,
				signatureS: sig.signature.s,
				...(sig.metadata.userVerificationRequired !== undefined
					? { userVerificationRequired: sig.metadata.userVerificationRequired }
					: {})
			});
			signInPhase = 'success';
			await land(res.sessionToken);
		} catch (e) {
			signInPhase = 'error';
			signInError = passkeyMessage(e, 'We could not sign you in with that passkey.');
		}
	}

	async function createAccount() {
		if (busy) return;
		touched = true;
		if (!name.trim() || !orgName.trim()) return;
		createPhase = 'waiting';
		createError = '';
		try {
			const backend = getBackend();
			await backend.ready;
			const cred = await createPasskey(name.trim());
			const res = await backend.mutation(api.auth.registerPasskey, {
				name: name.trim(),
				orgName: orgName.trim(),
				orgKind,
				country,
				credentialId: cred.credentialId,
				publicKey: cred.publicKey,
				address: cred.address
			});
			// Live: a new importer gets testnet funds straight from the Tempo faucet, so it can pay at once.
			if (orgKind === 'importer' && statusQ.data?.chainMode === 'live') {
				try {
					await liveFaucet(cred.address);
				} catch (e) {
					toast.error('Your account was created, but the faucet did not respond', {
						description: `${errorMessage(e)} Use "Get testnet funds" on your dashboard.`
					});
				}
			}
			createPhase = 'success';
			toast.success('Account created', {
				description: 'Your passkey is your sign-in on this device.'
			});
			await land(res.sessionToken);
		} catch (e) {
			createPhase = 'error';
			createError = passkeyMessage(e, 'We could not create your account.');
		}
	}

	async function signInAsPersona(p: DemoPersona) {
		if (busy) return;
		personaBusy = p.userId;
		personaError = '';
		try {
			const backend = getBackend();
			await backend.ready;
			const res = await backend.mutation(api.auth.signInAsDemo, { userId: p.userId });
			await land(res.sessionToken, { role: p.orgKind as AppRole, userId: p.userId });
		} catch (e) {
			personaError = errorMessage(e, 'Could not sign in as that persona.');
			toast.error('Demo sign-in failed', { description: personaError });
			personaBusy = null;
		}
	}
</script>

<svelte:head><title>Sign in · Portunus</title></svelte:head>

<div class="page">
	<svg
		class="arch"
		viewBox="0 0 900 520"
		fill="none"
		aria-hidden="true"
		preserveAspectRatio="xMidYMin slice"
	>
		<g stroke="currentColor" stroke-width="1">
			<path d="M170 520V250C170 134 298 52 450 52S730 134 730 250V520" />
			<path d="M230 520V256C230 160 328 96 450 96S670 160 670 256V520" />
			<path d="M290 520V262C290 186 358 138 450 138S610 186 610 262V520" />
			<path d="M60 520H840" />
		</g>
	</svg>

	<header class="top">
		<a class="back" href="/"
			><ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />Back to home</a
		>
		<ThemeToggle />
	</header>

	<main id="main" class="main" tabindex="-1">
		<div class="column">
			<a href="/" class="logo" aria-label="Portunus home"><Logo size={26} label="" /></a>

			<div class="intro">
				<h1>Sign in to Portunus</h1>
				<p>Use the passkey on this device. No passwords, no seed phrases.</p>
			</div>

			{#if checked && unsupported}
				<EmptyState
					compact
					tone="error"
					icon={ShieldAlert}
					title="Passkeys are not available here"
					description="{unsupported} You can still explore with a demo persona below."
				/>
			{:else}
				<div class="stack">
					<PasskeyButton
						fullWidth
						state={signInPhase}
						label="Sign in with passkey"
						onclick={signInWithPasskey}
						disabled={busy && signInPhase !== 'waiting'}
					/>
					{#if signInPhase === 'error' && signInError}
						<p class="failure" role="alert">{signInError}</p>
					{/if}
					<div class="tag"><TempoTag feature="passkey" size="sm" /></div>
				</div>

				<div class="divider"><span>New to Portunus?</span></div>

				{#if !createOpen}
					<PasskeyButton
						fullWidth
						variant="secondary"
						glyph="fingerprint"
						label="Create a passkey"
						sublabel="Set up your organization in a minute"
						onclick={() => (createOpen = true)}
						disabled={busy}
					/>
				{:else}
					<form
						class="create"
						novalidate
						onsubmit={(e) => {
							e.preventDefault();
							void createAccount();
						}}
					>
						<Field label="Your name" required error={nameError}>
							<Input
								bind:value={name}
								placeholder="Amara Okeke"
								autocomplete="name"
								disabled={busy}
							/>
						</Field>
						<Field label="Organization" required error={orgError}>
							<Input
								bind:value={orgName}
								placeholder="Harbourline Clearing"
								autocomplete="organization"
								disabled={busy}
							/>
						</Field>
						<div class="row2">
							<Field label="You are a">
								<SegmentedControl
									label="Account type"
									fullWidth
									disabled={busy}
									options={[
										{ value: 'importer', label: 'Importer' },
										{ value: 'line', label: 'Shipping line' }
									]}
									bind:value={orgKind}
								/>
							</Field>
							<Field label="Country">
								<Select bind:value={country} options={COUNTRIES} disabled={busy} />
							</Field>
						</div>
						<PasskeyButton
							fullWidth
							type="submit"
							variant="secondary"
							glyph="fingerprint"
							state={createPhase}
							label="Create account with passkey"
							sublabel={orgKind === 'line'
								? 'Your deposits account is set up for you'
								: 'Your account is funded with test money'}
							waitingLabel="Creating your passkey"
							successLabel="Account created"
							errorLabel="Not completed. Try again"
							disabled={busy && createPhase !== 'waiting'}
						/>
						{#if createPhase === 'error' && createError}
							<p class="failure" role="alert">{createError}</p>
						{/if}
					</form>
				{/if}
			{/if}
		</div>

		<section class="demo" aria-labelledby="demo-title">
			<div class="divider wide"><span id="demo-title">Or explore with a demo persona</span></div>
			<p class="demo-lead">
				No passkey needed. Switch between the shipping line and the importer at any time from the
				top bar, so one person can play both sides.
			</p>

			{#if personasQ.isLoading || !backendStatus.ready}
				<div class="grid" aria-busy="true">
					{#each [0, 1, 2] as i (i)}
						<div class="skel">
							<Skeleton circle width="2.5rem" height="2.5rem" /><Skeleton lines={3} />
						</div>
					{/each}
				</div>
			{:else if personasQ.error}
				<EmptyState
					compact
					tone="error"
					title="Could not load demo personas"
					description={errorMessage(personasQ.error)}
				/>
			{:else if groups.length === 0}
				<EmptyState
					compact
					icon={UsersRound}
					title="Demo sign-in is turned off"
					description="Sign in with a passkey, or create an account above."
				/>
			{:else}
				{#each groups as g (g.kind)}
					<h2 class="group">{g.label}</h2>
					<div class="grid">
						{#each g.items as p (p.userId)}
							<button
								type="button"
								class="persona"
								disabled={busy && personaBusy !== p.userId}
								aria-busy={personaBusy === p.userId}
								data-testid="persona-{p.name.split(' ')[0].toLowerCase()}"
								onclick={() => signInAsPersona(p)}
							>
								<span class="avatar kind-{p.orgKind}" aria-hidden="true">{initials(p.name)}</span>
								<span class="who">
									<span class="pname">{p.name}</span>
									<span class="ptitle">{p.title}</span>
								</span>
								<span class="go" aria-hidden="true">
									{#if personaBusy === p.userId}<Spinner size={16} />{:else}<ArrowRight
											size={16}
											strokeWidth={1.75}
										/>{/if}
								</span>
								<span class="org">
									<span class="oname">{p.orgName}</span>
									<Badge size="sm" variant="outline"
										>{p.orgKind === 'line'
											? 'Shipping line'
											: p.orgKind === 'importer'
												? 'Importer'
												: 'Resolver'}</Badge
									>
								</span>
								<span class="blurb">{p.blurb}</span>
							</button>
						{/each}
					</div>
				{/each}
				{#if personaError}<p class="failure" role="alert">{personaError}</p>{/if}
			{/if}
		</section>
	</main>

	<footer class="foot">
		<NetworkBadge />
		<span>Fees are sponsored. You never need gas.</span>
	</footer>
</div>

<style>
	.page {
		position: relative;
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
		background: var(--color-bg);
		isolation: isolate;
	}

	.arch {
		position: absolute;
		inset: 0 0 auto 50%;
		width: min(1100px, 140vw);
		height: auto;
		transform: translateX(-50%);
		color: var(--color-border);
		opacity: 0.45;
		z-index: -1;
		pointer-events: none;
		-webkit-mask-image: linear-gradient(to bottom, #000 30%, transparent 92%);
		mask-image: linear-gradient(to bottom, #000 30%, transparent 92%);
	}

	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-4) var(--gutter);
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1-5);
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
	}

	.back:hover {
		color: var(--color-text);
		text-decoration: none;
	}

	.main {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-10);
		width: 100%;
		max-width: 60rem;
		margin: 0 auto;
		padding: var(--space-6) var(--gutter) var(--space-16);
	}

	.main:focus {
		outline: none;
	}

	.column {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		width: 100%;
		max-width: 25rem;
	}

	.logo {
		display: inline-flex;
		align-self: flex-start;
		color: inherit;
	}

	.intro h1 {
		font-size: var(--text-2xl);
		line-height: var(--leading-2xl);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tight);
	}

	.intro p {
		margin-top: var(--space-1-5);
		text-wrap: balance;
		font-size: var(--text-base);
		line-height: var(--leading-base);
		color: var(--color-text-secondary);
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.tag {
		display: flex;
	}

	.failure {
		font-size: var(--text-sm);
		color: var(--tone-danger-fg);
	}

	.divider {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--color-border);
	}

	.create {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		animation: rise var(--duration-slow) var(--ease-out);
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}

	.row2 {
		display: grid;
		gap: var(--space-4);
	}

	/* ---------- demo personas ---------- */
	.demo {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		width: 100%;
	}

	.divider.wide {
		margin-bottom: var(--space-1);
	}

	.demo-lead {
		max-width: 38rem;
		margin: 0 auto;
		text-align: center;
		font-size: var(--text-sm);
		line-height: var(--leading-sm);
		color: var(--color-text-secondary);
	}

	.group {
		margin-top: var(--space-3);
		font-size: var(--text-2xs);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--color-text-tertiary);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
		gap: var(--space-4);
	}

	.skel {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-3);
		padding: var(--space-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
	}

	.persona {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		grid-template-areas:
			'avatar who go'
			'org org org'
			'blurb blurb blurb';
		align-items: center;
		align-content: start;
		gap: var(--space-3) var(--space-3);
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		text-align: left;
		transition:
			border-color var(--duration-fast) var(--ease-standard),
			box-shadow var(--duration-base) var(--ease-standard),
			transform var(--duration-fast) var(--ease-standard);
	}

	.persona:hover:not(:disabled) {
		border-color: var(--color-border-strong);
		box-shadow: var(--shadow-md);
		transform: translateY(-1px);
	}

	.persona:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
	}

	.persona:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.avatar {
		grid-area: avatar;
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: var(--radius-full);
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		letter-spacing: 0.02em;
	}

	.kind-line {
		background: var(--color-primary);
		color: var(--color-primary-fg);
	}

	.kind-importer {
		background: var(--color-accent-muted);
		color: var(--color-accent-text);
	}

	.kind-platform {
		background: var(--color-surface-active);
		color: var(--color-text-secondary);
	}

	.who {
		grid-area: who;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.pname {
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
		color: var(--color-text);
	}

	.ptitle {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}

	.go {
		grid-area: go;
		color: var(--color-text-tertiary);
		transition:
			color var(--duration-fast) var(--ease-standard),
			transform var(--duration-fast) var(--ease-standard);
	}

	.persona:hover:not(:disabled) .go {
		color: var(--color-accent-text);
		transform: translateX(2px);
	}

	.org {
		grid-area: org;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-border-subtle);
	}

	.oname {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text);
	}

	.blurb {
		grid-area: blurb;
		font-size: var(--text-xs);
		line-height: var(--leading-xs);
		color: var(--color-text-secondary);
	}

	.foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-6) var(--gutter);
		border-top: 1px solid var(--color-border);
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}
</style>
