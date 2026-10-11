<script lang="ts">
	/**
	 * Line dashboard (DESIGN 11.12, details 11.9): what the protocol holds, what the line is exposed
	 * to, which refunds are due and when. Reads from guard and access-key state.
	 */
	import AlarmClock from '@lucide/svelte/icons/alarm-clock';
	import FilePlus from '@lucide/svelte/icons/file-plus';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import Wallet from '@lucide/svelte/icons/wallet';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import {
		Badge,
		Button,
		Card,
		ContainerNumber,
		EmptyState,
		Meter,
		Money,
		PageHeader,
		SegmentedControl,
		Skeleton,
		Stat,
		StatusPill,
		Table,
		TempoTag,
		formatContainerNumber,
		formatDate,
		formatDuration,
		formatMoney,
		type TableColumn
	} from '#lib/ui';
	import { useAuthedQuery } from '#lib/backend';
	import {
		ModeBadge,
		ProductCountdown,
		SeriesChart,
		api,
		containerHref,
		errorMessage,
		lineRequestHref,
		relativeToProduct,
		units,
		useApp
	} from '#lib/app';
	import { headlineState, unitsToUsd } from '#lib/app/line/lineStatus.ts';

	const app = useApp();
	const dash = useAuthedQuery(api.dashboard.line, {});
	const detention = useAuthedQuery(api.containers.listForLine, {
		filter: { states: ['in_detention'] }
	});
	const heldContainers = useAuthedQuery(api.containers.listForLine, {
		filter: { mode: 'held' }
	});
	const requests = useAuthedQuery(api.releaseRequests.listForLine, {});

	const d = $derived(dash.data);
	const DAY = 86_400_000;

	let seriesKey = $state<'cashHeldPerDay' | 'refundsPerDay'>('cashHeldPerDay');
	const chartPoints = $derived(
		(d?.series[seriesKey] ?? []).map((p) => ({ t: p.t, value: unitsToUsd(p.valueUnits) }))
	);

	// Containers whose deposit sits in the guard right now.
	const HELD_NOW = [
		'deposit_held',
		'released',
		'in_free_time',
		'in_detention',
		'returned',
		'settling'
	];
	const heldCount = $derived(
		(heldContainers.data ?? []).filter((c) => HELD_NOW.includes(c.state)).length
	);

	const refundCols: TableColumn[] = [
		{ key: 'container', label: 'Container' },
		{ key: 'importer', label: 'Importer', hideBelow: 'md' },
		{ key: 'amount', label: 'To refund', numeric: true },
		{ key: 'deadline', label: 'Refund deadline', width: '10.5rem' },
		{ key: 'status', label: 'Compliance', width: '8.5rem' }
	];
	type RefundRow = NonNullable<typeof d>['refundsDue'][number];

	function refundStatus(r: RefundRow) {
		if (r.overdue) return { tone: 'danger' as const, text: 'Overdue' };
		if (r.deadline - (d?.now ?? app.now()) < DAY)
			return { tone: 'warning' as const, text: 'Due today' };
		return { tone: 'success' as const, text: 'On time' };
	}

	const detentionCols: TableColumn[] = [
		{ key: 'container', label: 'Container' },
		{ key: 'importer', label: 'Importer', hideBelow: 'md' },
		{ key: 'meter', label: 'Detention against deposit', width: '46%' }
	];

	const requestCols: TableColumn[] = [
		{ key: 'bl', label: 'Bill of lading' },
		{ key: 'importer', label: 'Importer', hideBelow: 'sm' },
		{ key: 'mode', label: 'Mode', hideBelow: 'md' },
		{ key: 'status', label: 'Status' },
		{ key: 'created', label: 'Created', hideBelow: 'lg' }
	];

	const KIND_LABEL: Record<string, string> = {
		deposit: 'Deposit held by protocol',
		detention_pull: 'Detention pulled',
		charge: 'Charges paid to the line',
		refund: 'Refunded to importer',
		dispute_release: 'Dispute resolved',
		key_authorized: 'Access key authorized',
		held_return: 'Held transfer returned'
	};

	const withinRule = $derived(
		d
			? d.compliance.settlementWindowDays <= 15 &&
					(d.compliance.maxReturnToRefundMs ?? 0) <= 15 * DAY
			: false
	);
</script>

<svelte:head><title>Dashboard · Portunus</title></svelte:head>

<PageHeader
	title="Dashboard"
	subtitle="Deposits held, deposit-free exposure and refund deadlines for {app.org.name}."
>
	{#snippet actions()}
		<Button href="/line/returns" variant="secondary" icon={PackageCheck}>Record a return</Button>
		<Button href="/line/requests/new" variant="primary" icon={FilePlus}>New release request</Button>
	{/snippet}
</PageHeader>

{#if dash.error}
	<Card>
		<EmptyState
			tone="error"
			title="The dashboard could not load"
			description={errorMessage(dash.error)}
		/>
	</Card>
{:else}
	<div class="page">
		<section class="kpis" aria-label="Key figures">
			<Stat
				label="Held by protocol"
				icon={ShieldCheck}
				loading={!d}
				value={d ? formatMoney(units(d.depositsHeldUnits), { compact: false }) : ''}
				hint={d
					? `${heldCount} ${heldCount === 1 ? 'container' : 'containers'}, none in your balance`
					: ''}
			>
				{#snippet footer()}<TempoTag
						feature="receive_policy"
						label="Receive policy"
						size="sm"
					/>{/snippet}
			</Stat>
			<Stat
				label="Deposit-free exposure"
				icon={KeyRound}
				loading={!d}
				value={d ? formatMoney(units(d.depositFreeExposureUnits)) : ''}
				hint={d
					? `${formatMoney(units(d.dailyCapTotalUnits))} per day across ${d.activeKeys} ${d.activeKeys === 1 ? 'key' : 'keys'}`
					: ''}
			>
				{#snippet footer()}<TempoTag
						feature="access_key"
						label="Access key caps"
						size="sm"
					/>{/snippet}
			</Stat>
			<Stat
				label="Past free time"
				icon={AlarmClock}
				loading={!d}
				value={d ? String(d.pastFreeTime) : ''}
				unit={d ? (d.pastFreeTime === 1 ? 'container' : 'containers') : ''}
				hint={d ? `${d.inFreeTime} still in free time` : ''}
				href="/containers"
			/>
			<Stat
				label="Detention collected"
				icon={Wallet}
				loading={!d}
				value={d ? formatMoney(units(d.detentionCollectedLast30Units)) : ''}
				hint={d ? `Last 30 days. ${formatMoney(units(d.detentionCollectedUnits))} in total` : ''}
			/>
			<Stat
				label="Refunds due"
				icon={Undo2}
				loading={!d}
				value={d ? formatMoney(d.refundsDue.reduce((t, r) => t + units(r.amountUnits), 0n)) : ''}
				hint={d
					? d.refundsDue.length === 0
						? 'Nothing waiting'
						: `${d.refundsDue.length} ${d.refundsDue.length === 1 ? 'container' : 'containers'}${d.overdueRefunds ? `, ${d.overdueRefunds} overdue` : ''}`
					: ''}
			/>
		</section>

		<div class="cols">
			<div class="main">
				<Card
					padding="none"
					title="Refunds due"
					description="Every refund is automatic at the end of the window. Deadlines run from the empty-return receipt."
				>
					{#snippet actions()}
						<Button href="/line/returns" variant="ghost" size="sm">Open returns</Button>
					{/snippet}
					<Table
						caption="Refunds due, by deadline"
						columns={refundCols}
						rows={d?.refundsDue ?? []}
						rowKey={(r) => r.containerId}
						loading={!d}
						framed={false}
						emptyTitle="No refunds waiting"
						emptyDescription="Refunds show up here once an empty return is recorded."
						emptyIcon={CircleCheck}
						highlight={(r) => r.overdue}
					>
						{#snippet cell(r, c)}
							{#if c.key === 'container'}
								<ContainerNumber value={r.number} href={containerHref(r.number)} />
							{:else if c.key === 'importer'}
								<span class="muted">{r.importerName}</span>
							{:else if c.key === 'amount'}
								<Money amount={units(r.amountUnits)} />
							{:else if c.key === 'deadline'}
								<ProductCountdown
									target={r.deadline}
									variant="inline"
									countUp
									showSeconds={false}
								/>
							{:else if c.key === 'status'}
								{@const s = refundStatus(r)}
								<Badge tone={s.tone} dot>{s.text}</Badge>
							{/if}
						{/snippet}
					</Table>
				</Card>

				<Card
					title="Last 30 days"
					description={seriesKey === 'cashHeldPerDay'
						? 'Deposits sitting in the protocol guard at the end of each day.'
						: 'Refunds paid out to importers each day.'}
				>
					{#snippet actions()}
						<SegmentedControl
							size="sm"
							label="Chart series"
							bind:value={seriesKey}
							options={[
								{ value: 'cashHeldPerDay', label: 'Held' },
								{ value: 'refundsPerDay', label: 'Refunded' }
							]}
						/>
					{/snippet}
					{#if !d}
						<Skeleton height="160px" />
					{:else}
						<SeriesChart
							points={chartPoints}
							kind={seriesKey === 'cashHeldPerDay' ? 'area' : 'bars'}
							label={seriesKey === 'cashHeldPerDay' ? 'Deposits held' : 'Refunded per day'}
						/>
					{/if}
				</Card>

				<Card
					padding="none"
					title="Containers in detention"
					description="Accrued detention against each deposit."
				>
					<Table
						caption="Containers in detention"
						columns={detentionCols}
						rows={detention.data ?? []}
						rowKey={(c) => c._id}
						loading={detention.isLoading}
						framed={false}
						emptyTitle="Nothing in detention"
						emptyDescription="Containers past free time appear here with a live meter."
						emptyIcon={AlarmClock}
						rowHref={(c) => containerHref(c.number)}
						rowLabel={(c) => `Open ${c.number}`}
					>
						{#snippet cell(c, col)}
							{#if col.key === 'container'}
								<ContainerNumber value={c.number} type={c.type} />
							{:else if col.key === 'importer'}
								<span class="muted">{c.importerName}</span>
							{:else if col.key === 'meter'}
								<Meter
									compact
									live
									value={units(c.accruedUnits)}
									max={units(c.depositUnits)}
									dailyRate={units(c.dailyRateUnits)}
									label="Detention accrued"
									maxLabel={c.mode === 'held' ? 'deposit' : 'maximum'}
								/>
							{/if}
						{/snippet}
					</Table>
				</Card>

				<Card padding="none" title="Release requests">
					{#snippet actions()}
						<Button href="/line/requests" variant="ghost" size="sm">View all</Button>
					{/snippet}
					<Table
						caption="Latest release requests"
						columns={requestCols}
						rows={(requests.data ?? []).slice(0, 5)}
						rowKey={(r) => r._id}
						loading={requests.isLoading}
						framed={false}
						emptyTitle="No release requests yet"
						emptyDescription="Create one to generate a deposit address per container."
						emptyIcon={FilePlus}
						rowHref={(r) => lineRequestHref(r._id)}
						rowLabel={(r) => `Open request ${r.billOfLading}`}
					>
						{#snippet cell(r, c)}
							{#if c.key === 'bl'}
								<span class="mono">{r.billOfLading}</span>
							{:else if c.key === 'importer'}
								<span class="muted">{r.importerName}</span>
							{:else if c.key === 'mode'}
								<ModeBadge mode={r.mode} size="sm" />
							{:else if c.key === 'containers'}
								{r.containerCount}
							{:else if c.key === 'status'}
								<StatusPill state={headlineState(r.byState)} />
							{:else if c.key === 'created'}
								<span class="muted tabular nowrap">{formatDate(r.createdAt)}</span>
							{/if}
						{/snippet}
					</Table>
				</Card>
			</div>

			<aside class="side" aria-label="Compliance and activity">
				<Card
					title="Refund compliance"
					description="Time from the return receipt to the refund, across settled returns."
				>
					{#if !d}
						<Skeleton lines={4} />
					{:else}
						<dl class="facts">
							<div>
								<dt>Average</dt>
								<dd class="tabular">
									{d.compliance.avgReturnToRefundMs === null
										? 'No settled returns yet'
										: formatDuration(d.compliance.avgReturnToRefundMs, 'long')}
								</dd>
							</div>
							<div>
								<dt>Slowest</dt>
								<dd class="tabular">
									{d.compliance.maxReturnToRefundMs === null
										? 'No settled returns yet'
										: formatDuration(d.compliance.maxReturnToRefundMs, 'long')}
								</dd>
							</div>
							<div>
								<dt>Settled returns</dt>
								<dd class="tabular">{d.compliance.settledCount}</dd>
							</div>
							<div>
								<dt>Settlement window</dt>
								<dd class="tabular">
									{d.compliance.settlementWindowDays}
									{d.compliance.settlementWindowDays === 1 ? 'day' : 'days'}
								</dd>
							</div>
						</dl>
						<div class="badges">
							{#if d.overdueRefunds > 0}
								<Badge tone="danger" dot>{d.overdueRefunds} overdue</Badge>
							{:else}
								<Badge tone="success" dot>Nothing overdue</Badge>
							{/if}
							<Badge
								tone={withinRule ? 'success' : 'warning'}
								icon={withinRule ? CircleCheck : AlarmClock}
							>
								{withinRule ? 'Meets the 15-day draft rule' : 'Above the 15-day draft rule'}
							</Badge>
						</div>
						<p class="note">
							Philippines draft rule: refunds within 15 days of the empty-return receipt. Change the
							window in <a href="/line/settings">settings</a>.
						</p>
					{/if}
				</Card>

				<Card
					title="Held transfers"
					description="Payments the guard did not accept. Nothing is lost."
				>
					<div class="held">
						<span class="held-count tabular">{d?.heldTransfers.count ?? 0}</span>
						<span class="muted">waiting for return</span>
					</div>
					{#snippet footer()}
						<div class="foot-row">
							<TempoTag feature="held_not_lost" size="sm" />
							<Button href="/line/held" variant="secondary" size="sm" icon={ShieldAlert}>
								Review
							</Button>
						</div>
					{/snippet}
				</Card>

				<Card title="Recent activity">
					{#if !d}
						<Skeleton lines={4} />
					{:else if d.recent.length === 0}
						<EmptyState compact title="No activity yet" />
					{:else}
						<ul class="feed">
							{#each d.recent as e (e._id)}
								<li>
									<div class="feed-main">
										<span class="feed-title">{KIND_LABEL[e.kind] ?? e.kind}</span>
										<span class="feed-meta muted">
											{#if e.containerNumber}
												<a class="mono" href={containerHref(e.containerNumber)}
													>{formatContainerNumber(e.containerNumber)}</a
												>
												·
											{/if}
											{relativeToProduct(e.timestamp, app.now())}
										</span>
									</div>
									{#if e.kind !== 'key_authorized' && e.amountUnits !== '0'}
										<Money amount={units(e.amountUnits)} size="sm" />
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</Card>
			</aside>
		</div>

		<p class="footnote">Reads from guard and access-key state.</p>
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
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
		gap: var(--space-4);
	}

	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 340px;
		gap: var(--space-4);
		align-items: start;
	}

	.main,
	.side {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}

	.muted {
		color: var(--color-text-secondary);
	}

	.nowrap {
		white-space: nowrap;
	}

	.facts {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-4) var(--space-3);
		margin: 0;
	}

	.facts dt {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
		margin-bottom: var(--space-0-5);
	}

	.facts dd {
		margin: 0;
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
	}

	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}

	.note {
		margin-top: var(--space-3);
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.held {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
	}

	.held-count {
		font-size: var(--text-3xl);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tight);
	}

	.foot-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.feed {
		display: flex;
		flex-direction: column;
		margin: calc(var(--space-2) * -1) 0;
	}

	.feed li {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-3);
		padding: var(--space-2-5) 0;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.feed li:last-child {
		border-bottom: 0;
	}

	.feed-main {
		display: flex;
		flex-direction: column;
		gap: var(--space-0-5);
		min-width: 0;
	}

	.feed-title {
		font-weight: var(--weight-medium);
	}

	.feed-meta {
		font-size: var(--text-xs);
	}

	.feed-meta a {
		color: inherit;
	}

	.footnote {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	@media (max-width: 1100px) {
		.cols {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
