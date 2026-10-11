<script lang="ts">
	/**
	 * Release request, line side (DESIGN 11.4 success state and the live view of 11.5/11.6): the
	 * virtual deposit address per container, how much has been received, and the release order.
	 * Everything here is a reactive query: when the importer pays or authorizes in another tab the
	 * page flips by itself, with a short highlight.
	 */
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import DoorOpen from '@lucide/svelte/icons/door-open';
	import SearchX from '@lucide/svelte/icons/search-x';
	import Send from '@lucide/svelte/icons/send';
	import {
		Badge,
		Button,
		Card,
		ContainerNumber,
		EmptyState,
		Hash,
		Money,
		PageHeader,
		Skeleton,
		StatusPill,
		Table,
		TempoTag,
		copyText,
		formatDate,
		formatDays,
		formatMoney,
		toast,
		type ContainerState,
		type TableColumn
	} from '#lib/ui';
	import { useAuthedMutation, useAuthedQuery } from '#lib/backend';
	import {
		ModeBadge,
		ProductCountdown,
		api,
		containerHref,
		errorMessage,
		importerRequestHref,
		units
	} from '#lib/app';
	import CoverageBar from '#lib/app/line/CoverageBar.svelte';
	import { headlineState } from '#lib/app/line/lineStatus.ts';

	let narrow = $state(false);
	onMount(() => {
		const mq = matchMedia('(max-width: 760px)');
		const sync = () => (narrow = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});
	const id = $derived(page.params.id ?? '');
	const req = useAuthedQuery(api.releaseRequests.get, () => ({ requestId: id as never }));
	const issue = useAuthedMutation(api.releaseRequests.issueReleaseOrder);

	const data = $derived(req.data);
	const request = $derived(data?.request);
	const containers = $derived(data?.containers ?? []);
	const isHeld = $derived(request?.mode === 'held');
	const isNew = $derived(page.url.searchParams.get('new') === '1');

	const READY: ContainerState[] = ['deposit_held', 'authorized'];
	const WAITING: ContainerState[] = ['requested', 'awaiting_deposit'];
	const ready = $derived(containers.filter((c) => READY.includes(c.state)));
	const waiting = $derived(containers.filter((c) => WAITING.includes(c.state)));
	const released = $derived(
		containers.filter((c) => !READY.includes(c.state) && !WAITING.includes(c.state))
	);
	const byState = $derived(
		containers.reduce<Record<string, number>>(
			(m, c) => ((m[c.state] = (m[c.state] ?? 0) + 1), m),
			{}
		)
	);
	const headline = $derived(headlineState(byState));

	const importerLink = $derived(
		request ? `${page.url.origin}${importerRequestHref(request._id)}` : ''
	);

	// ---- live changes -----------------------------------------------------------------------
	let previous = new Map<string, string>();
	let changed = $state(new Set<string>());
	let flash = $state(false);
	$effect(() => {
		const cs = data?.containers;
		if (!cs) return;
		const next = new Map(cs.map((c) => [c._id as string, c.state as string]));
		untrack(() => {
			if (previous.size > 0) {
				const diff = cs.filter((c) => previous.get(c._id) !== c.state);
				if (diff.length) {
					changed = new Set(diff.map((c) => c._id as string));
					const covered = diff.filter((c) => READY.includes(c.state));
					if (covered.length) {
						flash = true;
						toast.protocol(
							request?.mode === 'depositFree'
								? 'Access key authorized'
								: 'Deposit held by protocol',
							{
								description: `${data?.importer.name}: ${covered.length} ${covered.length === 1 ? 'container' : 'containers'} ready for release.`
							}
						);
					}
					setTimeout(() => {
						changed = new Set();
						flash = false;
					}, 2600);
				}
			}
			previous = next;
		});
	});

	// ---- release ------------------------------------------------------------------------------
	let releasing = $state(false);
	let releaseError = $state('');
	async function release() {
		if (releasing || !request) return;
		releasing = true;
		releaseError = '';
		try {
			const r = await issue({ requestId: request._id });
			toast.success('Release order issued', {
				description: `${r.released.length} ${r.released.length === 1 ? 'container' : 'containers'} released. Free time has started.${r.blocked.length ? ` ${r.blocked.length} still blocked.` : ''}`
			});
		} catch (e) {
			releaseError = errorMessage(e);
			toast.error('Could not issue the release order', { description: releaseError });
		} finally {
			releasing = false;
		}
	}

	function blockedReason(c: (typeof containers)[number]): string {
		if (c.state === 'requested') return 'Waiting for the importer to authorize the access key.';
		const missing = units(c.missingUnits);
		return units(c.receivedUnits) > 0n
			? `Deposit incomplete: ${formatMoney(missing)} still missing.`
			: `No deposit received yet: ${formatMoney(missing)} due.`;
	}

	let copied = $state(false);
	async function copyLink() {
		if (await copyText(importerLink)) {
			copied = true;
			toast.success('Importer link copied');
			setTimeout(() => (copied = false), 1800);
		}
	}

	// ---- derived copy for the status card ---------------------------------------------------
	const depositTotal = $derived(units(data?.totals.depositUnits));
	const receivedTotal = $derived(units(data?.totals.receivedUnits));
	const dailyTotal = $derived(units(data?.totals.dailyRateUnits));
	const keys = $derived(
		containers.flatMap((c) => (c.accessKey?.status === 'active' ? [c.accessKey] : []))
	);
	const keyExpiry = $derived(keys.length ? Math.max(...keys.map((k) => k.expiry)) : undefined);
	const keyDaily = $derived(keys.reduce((t, k) => t + units(k.dailyLimitUnits), 0n));

	const columns: TableColumn[] = [
		{ key: 'container', label: 'Container' },
		{ key: 'status', label: 'Status' },
		{ key: 'coverage', label: 'Deposit received', width: '15rem', hideBelow: 'sm' },
		{ key: 'free', label: 'Free time ends', width: '9rem', hideBelow: 'md' }
	];
</script>

<svelte:head><title>Release request · Portunus</title></svelte:head>

{#if req.isLoading}
	<PageHeader
		title="Release request"
		breadcrumbs={[{ label: 'Release requests', href: '/line/requests' }]}
	/>
	<div class="skeletons" aria-busy="true">
		<Skeleton height="7rem" radius="var(--radius-lg)" />
		<Skeleton height="12rem" radius="var(--radius-lg)" />
		<Skeleton height="14rem" radius="var(--radius-lg)" />
	</div>
{:else if req.error || !data || !request}
	<PageHeader
		title="Release request"
		breadcrumbs={[{ label: 'Release requests', href: '/line/requests' }]}
	/>
	<Card padding="lg">
		<EmptyState
			icon={SearchX}
			title="Request not found"
			description="It may belong to another line, or the link is wrong."
		>
			{#snippet actions()}
				<Button href="/line/requests" variant="secondary">All release requests</Button>
			{/snippet}
		</EmptyState>
	</Card>
{:else}
	<PageHeader
		title="Release request {request.billOfLading}"
		subtitle="To {data.importer.name}, {request.portOfDischarge}{request.vessel
			? `, ${request.vessel}`
			: ''}{request.voyage ? ` ${request.voyage}` : ''}"
		breadcrumbs={[
			{ label: 'Release requests', href: '/line/requests' },
			{ label: request.billOfLading }
		]}
	>
		{#snippet titleSnippet()}
			Release request <span class="mono bl">{request.billOfLading}</span>
		{/snippet}
		{#snippet meta()}
			<StatusPill state={headline} long size="lg" />
			<ModeBadge mode={request.mode} />
			<Badge tone="neutral" mono title="Request code">Code {request.requestCode}</Badge>
		{/snippet}
	</PageHeader>

	<div class="layout">
		<div class="left">
			<!-- Status: flips live when the importer pays or authorizes -->
			<Card class="o1" id="request-status">
				{#if isNew}
					<div class="sent" data-testid="request-sent">
						<span class="sent-icon"><Send size={16} strokeWidth={1.75} aria-hidden="true" /></span>
						<div>
							<h2 class="sent-title">Request sent to {data.importer.name}</h2>
							<p class="sent-text">
								{isHeld
									? 'They see the deposit per container and pay all of them in one tap.'
									: 'They see the daily cap and authorize an access key. No money moves.'}
							</p>
						</div>
					</div>
				{/if}

				{#if isHeld}
					<div class="state">
						<div class="state-main">
							{#if receivedTotal === 0n}
								<Badge tone="warning" dot pulse>Waiting for payment</Badge>
								<p class="state-line">
									{data.importer.name} has not paid yet. This page updates the moment the deposit lands.
								</p>
							{:else if data.totals.missingUnits !== '0'}
								<Badge tone="warning" dot pulse>Partly paid</Badge>
								<p class="state-line">
									{formatMoney(receivedTotal)} of {formatMoney(depositTotal)} received.
									{formatMoney(units(data.totals.missingUnits))} is still missing, so release stays blocked
									for the unpaid containers.
								</p>
							{:else if released.length === containers.length}
								<StatusPill state="released" long size="lg" />
								<p class="state-line">
									Release order issued. The deposit stays in the protocol guard until the empty
									returns.
								</p>
							{:else}
								<StatusPill state="deposit_held" long size="lg" />
								<p class="state-line">
									All {data.totals.containersTotal} deposits are final. Issue the release order.
								</p>
							{/if}
						</div>
						<div class="state-money">
							<Money amount={receivedTotal} size="xl" dimCents />
							<span class="of">of {formatMoney(depositTotal)} required</span>
							<CoverageBar
								value={Number(receivedTotal)}
								max={Number(depositTotal)}
								label="Deposit received"
							/>
						</div>
					</div>
					{#if receivedTotal > 0n}
						<div class="callout-wrap">
							<TempoTag
								feature="receive_policy"
								variant="callout"
								{flash}
								detail="The deposit left the importer and sits in the guard. Only the settlement contract can release it, to you for approved charges or back to the importer."
							/>
						</div>
					{/if}
				{:else}
					<div class="state">
						<div class="state-main">
							{#if keys.length === 0}
								<Badge tone="warning" dot pulse>Waiting for authorization</Badge>
								<p class="state-line">
									{data.importer.name} has not authorized the access key yet. No money moves in this mode.
								</p>
							{:else}
								<StatusPill
									state={released.length === containers.length ? 'released' : 'authorized'}
									label={released.length === containers.length
										? 'Release order issued'
										: `Authorized: up to ${formatMoney(keyDaily)} per day`}
									size="lg"
								/>
								<p class="state-line">
									{keys.length} of {containers.length} access keys active. You can pull at most one day
									of detention per day, only after free time ends.
								</p>
							{/if}
						</div>
						<div class="state-money">
							<Money amount={keyDaily || dailyTotal} size="xl" dimCents />
							<span class="of"
								>{keys.length ? 'per day, across all keys' : 'per day once authorized'}</span
							>
						</div>
					</div>
					{#if keys.length}
						<div class="callout-wrap">
							<TempoTag
								feature="access_key"
								variant="callout"
								{flash}
								label="Access key: up to {formatMoney(keyDaily)} per day, payable only to {data.line
									.name}, expires {keyExpiry ? formatDate(keyExpiry) : 'after free time'}"
								detail="The cap, the single recipient and the expiry are enforced by the protocol, not by Portunus."
							/>
						</div>
					{/if}
				{/if}
			</Card>

			<Card
				class="o3 {isNew ? 'hero' : ''}"
				title="Deposit addresses"
				description={isHeld
					? 'The importer pays each container to its own address. Payments land already matched.'
					: 'Each container has its own address as its reference. No deposit is expected in this mode.'}
				id="addresses"
			>
				{#snippet actions()}<span class="tag-wide"><TempoTag feature="virtual_address" /></span
					>{/snippet}
				<div class="tag-narrow"><TempoTag feature="virtual_address" /></div>
				<ul class="addresses">
					{#each containers as c, i (c._id)}
						<li style:--i={i} data-testid="deposit-address">
							<ContainerNumber value={c.number} type={c.type} href={containerHref(c.number)} />
							<Hash
								value={c.depositAddress}
								kind="address"
								full={!narrow}
								head={12}
								tail={10}
								size="md"
								class="addr"
							/>
						</li>
					{/each}
				</ul>
			</Card>

			<Card
				class="o4"
				padding="none"
				title="Containers"
				description="Live status. Highlighted rows just changed."
			>
				<Table
					caption="Containers on this request"
					{columns}
					rows={containers}
					rowKey={(c) => c._id}
					framed={false}
					highlight={(c) => changed.has(c._id)}
				>
					{#snippet cell(c, col)}
						{#if col.key === 'container'}
							<div class="cn-cell">
								<ContainerNumber value={c.number} type={c.type} href={containerHref(c.number)} />
								<span class="terms tabular">
									{formatDays(c.freeDays)} free, {formatMoney(units(c.dailyRateUnits))} per day
								</span>
							</div>
						{:else if col.key === 'status'}
							<StatusPill state={c.pendingOnChainFlag ? 'pending_onchain' : c.state} />
						{:else if col.key === 'coverage'}
							{#if isHeld}
								<div class="cov">
									<span class="tabular cov-fig">
										<Money amount={units(c.receivedUnits)} />
										<span class="of">of {formatMoney(units(c.depositUnits))}</span>
									</span>
									<CoverageBar
										value={Number(units(c.receivedUnits))}
										max={Number(units(c.depositUnits))}
										label="Deposit received for {c.number}"
									/>
								</div>
							{:else if c.accessKey?.status === 'active'}
								<span class="tabular"
									>Up to {formatMoney(units(c.accessKey.dailyLimitUnits))} per day</span
								>
							{:else if c.accessKey?.status === 'revoked'}
								<span class="muted">Key revoked</span>
							{:else}
								<span class="muted">Not authorized yet</span>
							{/if}
						{:else if col.key === 'free'}
							{#if c.freeTimeEndsAt}
								<ProductCountdown
									target={c.freeTimeEndsAt}
									variant="inline"
									countUp
									showSeconds={false}
								/>
							{:else}
								<span class="muted">Starts at release</span>
							{/if}
						{/if}
					{/snippet}
				</Table>
			</Card>
		</div>

		<div class="right">
			<Card class="o2" title="Release order" id="release-card">
				{#if released.length === containers.length}
					<p class="done">
						<Check size={14} strokeWidth={2} aria-hidden="true" />
						{containers.length === 1
							? 'Issued for the container.'
							: `Issued for all ${containers.length} containers.`}
					</p>
				{:else}
					<p class="lead">
						{#if ready.length > 0}
							<strong class="tabular">{ready.length} of {containers.length}</strong>
							{ready.length === 1 ? 'container is' : 'containers are'} covered and ready.
						{:else}
							No container is covered yet.
						{/if}
					</p>
					{#if waiting.length}
						<ul class="blocked" aria-label="Blocked containers">
							{#each waiting as c (c._id)}
								<li>
									<ContainerNumber value={c.number} size="sm" />
									<span>{blockedReason(c)}</span>
								</li>
							{/each}
						</ul>
					{/if}
					{#if releaseError}<p class="err" role="alert">{releaseError}</p>{/if}
				{/if}
				{#snippet footer()}
					{#if released.length < containers.length}
						<Button
							variant="accent"
							fullWidth
							icon={DoorOpen}
							loading={releasing}
							loadingLabel="Issuing"
							disabled={ready.length === 0}
							onclick={release}
							data-testid="issue-release"
						>
							Issue release order
						</Button>
					{:else}
						<span>Free time is running. See each container above.</span>
					{/if}
				{/snippet}
			</Card>

			<Card class="o5" title="Importer link" description="Send this to {data.importer.name}.">
				<div class="link">
					<span class="mono url" data-testid="importer-link">{importerLink}</span>
					<Button
						variant="secondary"
						size="sm"
						icon={copied ? Check : Copy}
						onclick={copyLink}
						aria-label="Copy importer link"
					>
						{copied ? 'Copied' : 'Copy link'}
					</Button>
				</div>
			</Card>

			<Card class="o6" title="Terms the importer sees">
				<dl class="facts">
					<div>
						<dt>Settlement window</dt>
						<dd class="tabular">{formatDays(data.terms.settlementWindowDays)}</dd>
					</div>
					<div>
						<dt>Maximum detention</dt>
						<dd class="tabular">{formatDays(data.terms.maxDetentionDays)}</dd>
					</div>
					<div>
						<dt>Containers</dt>
						<dd class="tabular">{containers.length}</dd>
					</div>
				</dl>
				<p class="rule">{data.terms.refundRule}</p>
			</Card>
		</div>
	</div>
{/if}

<style>
	.bl {
		font-weight: var(--weight-medium);
		letter-spacing: 0;
	}

	.skeletons,
	.left,
	.right {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}

	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 340px;
		gap: var(--space-4);
		align-items: start;
	}

	.right {
		position: sticky;
		top: calc(var(--topbar-height) + var(--space-4));
	}

	.sent {
		display: flex;
		gap: var(--space-3);
		padding-bottom: var(--space-4);
		margin-bottom: var(--space-4);
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.sent-icon {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		flex-shrink: 0;
		border-radius: var(--radius-full);
		background: var(--color-accent-subtle);
		color: var(--color-accent-text);
	}

	.sent-title {
		font-size: var(--text-lg);
		line-height: var(--leading-lg);
	}

	.sent-text {
		color: var(--color-text-secondary);
	}

	.state {
		display: flex;
		justify-content: space-between;
		gap: var(--space-6);
		align-items: flex-start;
	}

	.state-main {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-3);
		min-width: 0;
		max-width: 34rem;
	}

	.state-line {
		color: var(--color-text-secondary);
	}

	.state-money {
		display: flex;
		flex-direction: column;
		gap: var(--space-1-5);
		align-items: flex-end;
		min-width: 12rem;
		text-align: right;
	}

	.state-money :global(.bar) {
		align-self: stretch;
		margin-top: var(--space-1);
	}

	.of {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.callout-wrap {
		margin-top: var(--space-5);
	}

	:global(.hero) {
		border-color: var(--color-accent-border);
		box-shadow: var(--shadow-md);
	}

	.addresses {
		display: flex;
		flex-direction: column;
		margin: calc(var(--space-2) * -1) 0;
	}

	.addresses li {
		display: grid;
		grid-template-columns: 15rem minmax(0, 1fr);
		gap: var(--space-4);
		align-items: center;
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--color-border-subtle);
		animation: rise var(--duration-slow) var(--ease-out) both;
		animation-delay: calc(var(--i) * 140ms);
	}

	.addresses li:last-child {
		border-bottom: 0;
	}

	.addresses :global(.addr) {
		min-width: 0;
		word-break: break-all;
	}

	.tag-narrow {
		display: none;
		margin-bottom: var(--space-3);
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}

	.cn-cell {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.terms {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.cov {
		display: flex;
		flex-direction: column;
		gap: var(--space-1-5);
	}

	.cov-fig {
		display: flex;
		align-items: baseline;
		gap: var(--space-1);
	}

	.muted {
		color: var(--color-text-secondary);
	}

	.lead {
		margin-bottom: var(--space-3);
	}

	.done {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--tone-success-fg);
		font-weight: var(--weight-medium);
	}

	.blocked {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
	}

	.blocked li {
		display: flex;
		flex-direction: column;
		gap: var(--space-0-5);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--tone-warning-bg);
		color: var(--tone-warning-fg);
		font-size: var(--text-xs);
	}

	.err {
		margin-top: var(--space-3);
		color: var(--tone-danger-fg);
		font-size: var(--text-xs);
	}

	.link {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		align-items: flex-start;
	}

	.url {
		display: block;
		width: 100%;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--color-surface-sunken);
		font-size: var(--text-xs);
		word-break: break-all;
	}

	.facts {
		display: flex;
		flex-direction: column;
		margin: 0;
	}

	.facts > div {
		display: flex;
		justify-content: space-between;
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.facts dt {
		color: var(--color-text-secondary);
	}

	.facts dd {
		margin: 0;
		font-weight: var(--weight-medium);
	}

	.rule {
		margin-top: var(--space-3);
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}

	@media (max-width: 1100px) {
		.layout {
			display: flex;
			flex-direction: column;
			align-items: stretch;
		}

		.left,
		.right {
			display: contents;
		}

		.right {
			position: static;
		}

		:global(.o1) {
			order: 1;
		}
		:global(.o2) {
			order: 2;
		}
		:global(.o3) {
			order: 3;
		}
		:global(.o4) {
			order: 4;
		}
		:global(.o5) {
			order: 5;
		}
		:global(.o6) {
			order: 6;
		}
	}

	@media (max-width: 760px) {
		.tag-wide {
			display: none;
		}

		.tag-narrow {
			display: block;
		}

		.state {
			flex-direction: column;
			gap: var(--space-4);
		}

		.state-money {
			align-items: flex-start;
			text-align: left;
			width: 100%;
		}

		.addresses li {
			grid-template-columns: 1fr;
			gap: var(--space-2);
		}
	}
</style>
