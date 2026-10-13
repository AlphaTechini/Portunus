<script lang="ts">
	/**
	 * Importer dashboard (DESIGN 11.11, details 11.9). The demo video closes here: cash freed and
	 * the time from return to refund. Reads from memos and settlement events.
	 */
	import AlarmClock from '@lucide/svelte/icons/alarm-clock';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Banknote from '@lucide/svelte/icons/banknote';
	import Boxes from '@lucide/svelte/icons/boxes';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Copy from '@lucide/svelte/icons/copy';
	import FileSignature from '@lucide/svelte/icons/file-signature';
	import Hourglass from '@lucide/svelte/icons/hourglass';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Receipt from '@lucide/svelte/icons/receipt';
	import Timer from '@lucide/svelte/icons/timer';
	import Wallet from '@lucide/svelte/icons/wallet';
	import {
		Badge,
		Button,
		Card,
		ContainerNumber,
		EmptyState,
		Hash,
		Money,
		PageHeader,
		SegmentedControl,
		Skeleton,
		Stat,
		StatusPill,
		Table,
		TempoTag,
		copyText,
		formatCount,
		formatDate,
		formatMoney,
		toast,
		toUsd,
		type TableColumn
	} from '#lib/ui';
	import {
		LiveWallet,
		ModeBadge,
		ProductCountdown,
		SeriesChart,
		api,
		containerHref,
		errorMessage,
		formatRefundTime,
		importerRequestHref,
		inGroup,
		splitRefundTime,
		units,
		useApp,
		useProductNow,
		type StateGroup
	} from '#lib/app';
	import { useAuthedQuery } from '#lib/backend';

	const app = useApp();
	const clock = useProductNow();
	const dash = useAuthedQuery(api.dashboard.importer, {});
	const requests = useAuthedQuery(api.releaseRequests.listForImporter, {});
	const containers = useAuthedQuery(api.containers.listForImporter, {});

	const d = $derived(dash.data);

	// ---- KPI figures -------------------------------------------------------------------------
	const heldSeries = $derived(
		(d?.series.cashHeldPerDay ?? []).map((p) => toUsd(units(p.valueUnits)))
	);
	const refundPoints = $derived(
		(d?.series.refundsPerDay ?? []).map((p) => ({ t: p.t, value: toUsd(units(p.valueUnits)) }))
	);
	const heldPoints = $derived(
		(d?.series.cashHeldPerDay ?? []).map((p) => ({ t: p.t, value: toUsd(units(p.valueUnits)) }))
	);
	const refundTime = $derived(
		d?.avgReturnToRefundMs != null ? splitRefundTime(d.avgReturnToRefundMs) : null
	);
	const heldCount = $derived(
		(containers.data ?? []).filter(
			(c) =>
				c.mode === 'held' &&
				[
					'deposit_held',
					'released',
					'in_free_time',
					'in_detention',
					'returned',
					'settling'
				].includes(c.state)
		).length
	);

	// ---- needs your action -------------------------------------------------------------------
	const requestsToAct = $derived(
		(requests.data ?? []).filter(
			(r) => (r.byState.requested ?? 0) + (r.byState.awaiting_deposit ?? 0) > 0
		)
	);
	const chargesToReview = $derived(
		(containers.data ?? []).filter((c) => c.state === 'returned' && c.chargesPostedAt !== undefined)
	);
	const SOON_MS = 5 * 24 * 3_600_000;
	const endingSoon = $derived(
		(d?.upcoming ?? []).filter((c) => c.freeTimeEndsAt - clock.value < SOON_MS)
	);
	const actionCount = $derived(requestsToAct.length + chargesToReview.length + endingSoon.length);

	// ---- containers table --------------------------------------------------------------------
	let group = $state<StateGroup>('all');
	const active = $derived(
		(containers.data ?? []).filter(
			(c) => !['settled', 'requested', 'awaiting_deposit'].includes(c.state)
		)
	);
	const shown = $derived(active.filter((c) => inGroup(c.state, group)));
	const columns: TableColumn[] = [
		{ key: 'number', label: 'Container' },
		{ key: 'line', label: 'Line', hideBelow: 'md' },
		{ key: 'state', label: 'Status' },
		{ key: 'time', label: 'Time left', hideBelow: 'sm' },
		{ key: 'money', label: 'Deposit', numeric: true, hideBelow: 'sm' }
	];

	// ---- recent refunds ----------------------------------------------------------------------
	const refunds = $derived(
		(containers.data ?? [])
			.filter((c) => c.mode === 'held' && c.state === 'settled' && c.settledAt && c.returnedAt)
			.sort((x, y) => y.settledAt! - x.settledAt!)
			.slice(0, 5)
			.map((c) => ({
				c,
				ms: c.settledAt! - c.returnedAt!,
				tx: d?.recent.find((p) => p.kind === 'refund' && p.containerId === c._id)?.txHash ?? ''
			}))
	);
	const refundColumns: TableColumn[] = [
		{ key: 'number', label: 'Container' },
		{ key: 'amount', label: 'Refunded', numeric: true },
		{ key: 'time', label: 'Return to refund', numeric: true },
		{ key: 'tx', label: 'Transaction', hideBelow: 'lg' }
	];

	async function copyAddress() {
		const addr = app.org.tempoAddress;
		if (!addr) return;
		toast.show((await copyText(addr)) ? 'Payer address copied' : 'Could not copy the address');
	}
</script>

<svelte:head><title>Dashboard · Portunus</title></svelte:head>

<PageHeader title="Dashboard" subtitle="Your deposits, refunds and containers." />

{#if app.chainMode === 'live'}
	<div class="live-wallet"><LiveWallet /></div>
{/if}

{#if dash.error}
	<Card padding="lg">
		<EmptyState
			tone="error"
			title="Could not load your dashboard"
			description={errorMessage(dash.error)}
		>
			{#snippet actions()}
				<Button variant="secondary" onclick={() => location.reload()}>Try again</Button>
			{/snippet}
		</EmptyState>
	</Card>
{:else if d && d.containersTotal === 0 && !requests.isLoading && (requests.data?.length ?? 0) === 0}
	<Card padding="lg">
		<EmptyState
			icon={Boxes}
			title="No containers yet"
			description="When a shipping line sends you a release request it shows up here. Share your payer address so lines can find you."
		>
			{#snippet actions()}
				<Button variant="secondary" icon={Copy} onclick={copyAddress}>Copy my payer address</Button>
			{/snippet}
		</EmptyState>
	</Card>
{:else}
	<div class="page">
		<!-- KPI row -->
		<section class="kpis" aria-label="Key figures">
			<Stat
				label="Cash currently held"
				icon={Wallet}
				loading={!d}
				sparkline={heldSeries.length ? heldSeries : undefined}
				sparklineLabel="Cash held over the last 30 days"
				hint={d
					? `${formatCount(heldCount)} ${heldCount === 1 ? 'container' : 'containers'} with a held deposit`
					: undefined}
			>
				{#snippet valueSnippet()}
					{#if d}<Money amount={units(d.cashHeldUnits)} size="xl" dimCents />{/if}
				{/snippet}
				{#snippet footer()}
					<TempoTag feature="receive_policy" size="sm" label="Held by the protocol guard" />
				{/snippet}
			</Stat>
			<Stat
				label="Cash freed, last 30 days"
				icon={Banknote}
				loading={!d}
				hint={d ? `${formatMoney(units(d.cashFreedTotalUnits))} freed in total` : undefined}
			>
				{#snippet valueSnippet()}
					{#if d}<Money
							amount={units(d.cashFreedThisMonthUnits)}
							size="xl"
							tone="positive"
							dimCents
						/>{/if}
				{/snippet}
			</Stat>
			<Stat
				label="Return to refund"
				icon={Timer}
				loading={!d}
				value={refundTime ? refundTime[0] : '–'}
				unit={refundTime ? refundTime[1] : undefined}
				hint={d
					? d.refundCount
						? `Average time from return to refund, across ${formatCount(d.refundCount)} ${d.refundCount === 1 ? 'refund' : 'refunds'}`
						: 'Average time from return to refund. No refunds yet'
					: undefined}
			>
				{#snippet footer()}
					<TempoTag feature="refund_seconds" size="sm" />
				{/snippet}
			</Stat>
			<Stat
				label="Containers out now"
				icon={AlarmClock}
				loading={!d}
				value={d ? formatCount(d.inFreeTime + d.inDetention) : undefined}
				hint={d ? `${d.inFreeTime} in free time, ${d.inDetention} in detention` : undefined}
			/>
		</section>

		<!-- Needs your action -->
		{#if actionCount > 0}
			<Card
				title="Needs your action"
				description="{actionCount} {actionCount === 1 ? 'item' : 'items'} waiting for you."
			>
				<ul class="actions" data-testid="needs-action">
					{#each requestsToAct as r (r._id)}
						{@const free = r.mode === 'depositFree'}
						<li class="action">
							<span class="a-icon warn" aria-hidden="true">
								{#if free}<KeyRound size={16} strokeWidth={1.75} />{:else}<Hourglass
										size={16}
										strokeWidth={1.75}
									/>{/if}
							</span>
							<div class="a-main">
								<p class="a-title">
									{free ? 'Authorize' : 'Pay deposits for'}
									<span class="mono">{r.billOfLading}</span>
								</p>
								<p class="a-sub">
									{r.lineName}, {r.containerCount}
									{r.containerCount === 1 ? 'container' : 'containers'}{free
										? ', no money moves'
										: ''}
								</p>
							</div>
							<div class="a-side">
								{#if free}
									<Badge tone="info" variant="outline">Deposit-free</Badge>
								{:else}
									<Money
										amount={units(r.depositTotalUnits) - units(r.receivedTotalUnits)}
										size="md"
									/>
								{/if}
							</div>
							<Button
								variant="secondary"
								size="sm"
								href={importerRequestHref(r._id)}
								iconEnd={ArrowRight}
							>
								Review
							</Button>
						</li>
					{/each}
					{#each chargesToReview as c (c._id)}
						<li class="action">
							<span class="a-icon info" aria-hidden="true"
								><Receipt size={16} strokeWidth={1.75} /></span
							>
							<div class="a-main">
								<p class="a-title">
									Charges posted for <ContainerNumber value={c.number} type={c.type} size="sm" />
								</p>
								<p class="a-sub">
									Accept them, or dispute once, before the window ends
									{#if c.settlementWindowEndsAt}
										<ProductCountdown
											target={c.settlementWindowEndsAt}
											variant="inline"
											size="sm"
											label="in"
										/>
									{/if}
								</p>
							</div>
							<div class="a-side">
								<Money amount={units(c.chargesUnits ?? c.accruedUnits)} size="md" />
							</div>
							<Button
								variant="secondary"
								size="sm"
								href={containerHref(c.number)}
								iconEnd={ArrowRight}
							>
								Review
							</Button>
						</li>
					{/each}
					{#each endingSoon as c (c.containerId)}
						<li class="action">
							<span class="a-icon caution" aria-hidden="true"
								><AlarmClock size={16} strokeWidth={1.75} /></span
							>
							<div class="a-main">
								<p class="a-title">
									Free time ends soon for <ContainerNumber value={c.number} size="sm" />
								</p>
								<p class="a-sub">
									Return the empty before detention of {formatMoney(units(c.dailyRateUnits))} per day
									starts
								</p>
							</div>
							<div class="a-side">
								<ProductCountdown target={c.freeTimeEndsAt} variant="inline" label="Ends in" />
							</div>
							<Button
								variant="secondary"
								size="sm"
								href={containerHref(c.number)}
								iconEnd={ArrowRight}
							>
								Open
							</Button>
						</li>
					{/each}
				</ul>
			</Card>
		{:else if d}
			<Card padding="md">
				<p class="allclear">
					<CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" />
					Nothing needs your action right now.
				</p>
			</Card>
		{/if}

		<!-- Series -->
		<section class="charts" aria-label="Trends">
			<Card title="Cash held" description="Deposits held by the protocol, last 30 days.">
				{#if d}
					<SeriesChart points={heldPoints} kind="area" label="Cash held per day, last 30 days" />
				{:else}
					<Skeleton height="132px" />
				{/if}
			</Card>
			<Card title="Cash freed per day" description="Refunds received, last 30 days.">
				{#if d}
					<SeriesChart points={refundPoints} kind="bars" label="Cash freed per day, last 30 days" />
				{:else}
					<Skeleton height="132px" />
				{/if}
			</Card>
		</section>

		<!-- Containers -->
		<Card
			padding="none"
			title="Containers"
			description="Out now: in free time, in detention, or returned and waiting to settle."
		>
			{#snippet actions()}
				<SegmentedControl
					label="Filter containers"
					size="sm"
					bind:value={group}
					options={[
						{ value: 'all', label: 'All' },
						{ value: 'free_time', label: 'Free time' },
						{ value: 'detention', label: 'Detention' },
						{ value: 'returned', label: 'Returned' }
					]}
				/>
			{/snippet}
			<Table
				framed={false}
				{columns}
				rows={shown}
				rowKey={(c) => c._id}
				caption="Containers currently out"
				rowHref={(c) => containerHref(c.number)}
				rowLabel={(c) => c.number}
				loading={containers.isLoading}
				emptyTitle="No containers here"
				emptyDescription="Nothing matches this filter."
				emptyIcon={Boxes}
			>
				{#snippet cell(c, col)}
					{#if col.key === 'number'}
						<div class="cell-stack">
							<ContainerNumber value={c.number} type={c.type} size="sm" />
							<ModeBadge mode={c.mode} size="sm" />
						</div>
					{:else if col.key === 'line'}
						{c.lineName}
					{:else if col.key === 'state'}
						<StatusPill state={c.pendingOnChainFlag ? 'pending_onchain' : c.state} />
					{:else if col.key === 'time'}
						{#if c.state === 'returned' && c.settlementWindowEndsAt}
							<ProductCountdown target={c.settlementWindowEndsAt} variant="inline" label="Window" />
						{:else if c.freeTimeEndsAt && (c.state === 'in_free_time' || c.state === 'released' || c.state === 'in_detention')}
							<ProductCountdown
								target={c.freeTimeEndsAt}
								variant="inline"
								countUp
								elapsedLabel="Detention"
							/>
						{:else}
							<span class="muted">–</span>
						{/if}
					{:else if col.key === 'money'}
						{#if c.mode === 'held'}
							<Money amount={units(c.receivedUnits)} size="sm" />
							{#if c.state === 'in_detention'}
								<div class="sub">accrued {formatMoney(units(c.accruedUnits))}</div>
							{/if}
						{:else}
							<span class="sub">{formatMoney(units(c.dailyRateUnits))} per day cap</span>
						{/if}
					{/if}
				{/snippet}
			</Table>
		</Card>

		<!-- Recent refunds -->
		<Card
			padding="none"
			title="Recent refunds"
			description="Last settlements, with the time from return to refund."
		>
			<Table
				framed={false}
				columns={refundColumns}
				rows={refunds}
				rowKey={(r) => r.c._id}
				caption="Recent refunds"
				loading={containers.isLoading}
				emptyTitle="No refunds yet"
				emptyDescription="Refunds appear here the moment a container settles."
				emptyIcon={FileSignature}
			>
				{#snippet cell(r, col)}
					{#if col.key === 'number'}
						<div class="cell-stack">
							<ContainerNumber value={r.c.number} size="sm" href={containerHref(r.c.number)} />
							<span class="sub date">{formatDate(r.c.settledAt!)}</span>
						</div>
					{:else if col.key === 'amount'}
						<Money amount={units(r.c.refundUnits ?? '0')} size="md" tone="positive" />
					{:else if col.key === 'time'}
						<strong class="tabular">{formatRefundTime(r.ms)}</strong>
					{:else if col.key === 'tx'}
						{#if r.tx}<Hash value={app.displayHash(r.tx)} kind="tx" size="sm" />{:else}<span
								class="muted">–</span
							>{/if}
					{/if}
				{/snippet}
			</Table>
		</Card>

		<p class="foot">Reads from memos and settlement events.</p>
	</div>
{/if}

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	.kpis {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-4);
	}

	.charts {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-4);
	}

	.live-wallet {
		margin-bottom: var(--space-5);
	}
	.actions {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.action {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto auto;
		align-items: center;
		gap: var(--space-3) var(--space-4);
		padding: var(--space-3) 0;
		border-top: 1px solid var(--color-border-subtle);
	}
	.action:first-child {
		border-top: 0;
		padding-top: 0;
	}
	.action:last-child {
		padding-bottom: 0;
	}

	.a-icon {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: var(--radius-md);
	}
	.a-icon.warn {
		background: var(--tone-warning-bg);
		color: var(--tone-warning-fg);
	}
	.a-icon.info {
		background: var(--tone-info-bg);
		color: var(--tone-info-fg);
	}
	.a-icon.caution {
		background: var(--tone-caution-bg);
		color: var(--tone-caution-fg);
	}

	.a-main {
		min-width: 0;
	}
	.a-title {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1-5);
		font-size: var(--text-base);
		font-weight: var(--weight-medium);
		color: var(--color-text);
	}
	.a-sub {
		margin: var(--space-0-5) 0 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1-5);
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}
	.a-side {
		text-align: right;
	}

	.allclear {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
		color: var(--color-text-secondary);
	}
	.allclear :global(svg) {
		color: var(--tone-success-fg);
	}

	.cell-stack {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
	}
	.sub {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}
	.muted {
		color: var(--color-text-tertiary);
	}
	@media (max-width: 560px) {
		.date {
			display: none;
		}
	}

	.foot {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	@media (max-width: 1100px) {
		.kpis {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 760px) {
		.kpis,
		.charts {
			grid-template-columns: minmax(0, 1fr);
		}
		.action {
			grid-template-columns: auto minmax(0, 1fr);
		}
		.a-side {
			grid-column: 2;
			text-align: left;
		}
		.action > :global(a) {
			grid-column: 2;
			justify-self: start;
		}
	}
</style>
