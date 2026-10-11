<script lang="ts">
	/**
	 * Container detail (DESIGN 11.7), shared by the line, the importer and the dispute resolver.
	 * The demo's centerpiece: free-time countdown, live detention, the memo trail with its
	 * finality times, and the chain refusing a second same-day pull.
	 */
	import { page } from '$app/state';
	import Ban from '@lucide/svelte/icons/ban';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import FileQuestion from '@lucide/svelte/icons/file-question';
	import Flag from '@lucide/svelte/icons/flag';
	import Gavel from '@lucide/svelte/icons/gavel';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Scale from '@lucide/svelte/icons/scale';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import {
		Badge,
		Button,
		Card,
		ContainerNumber,
		EmptyState,
		Hash,
		Meter,
		Money,
		PageHeader,
		Skeleton,
		StatusPill,
		Table,
		Tabs,
		TempoTag,
		Timeline,
		formatContainerNumber,
		formatDate,
		formatDateTime,
		formatDays,
		formatMoney,
		toast,
		type ContainerState,
		type TableColumn
	} from '#lib/ui';
	import {
		ChainResult,
		DAY_MS,
		ModeBadge,
		Notice,
		ProductCountdown,
		RevokeKeyButton,
		accrued,
		api,
		buildTrail,
		detentionDaysAt,
		errorMessage,
		formatRefundTime,
		isRefusedPull,
		units,
		useApp,
		useContainerRef,
		useDemoActions,
		useDemoPageActions,
		useProductNow
	} from '#lib/app';
	import { useAuthedAction, useAuthedMutation } from '#lib/backend';
	import DisputeModal from './DisputeModal.svelte';
	import ReturnReceiptModal from './ReturnReceiptModal.svelte';

	const app = useApp();
	const clock = useProductNow();
	const demo = useDemoActions();
	const ref = useContainerRef(() => page.params.number);
	const accept = useAuthedAction(api.containers.acceptCharges);
	const triggerSettle = useAuthedAction(api.containers.triggerSettlement);
	const contest = useAuthedMutation(api.containers.contestReturnReceipt);

	const d = $derived(ref.detail);
	const c = $derived(d?.container);
	const key = $derived(d?.accessKey ?? null);
	const isImporter = $derived(app.role === 'importer');
	const isLine = $derived(app.role === 'line');
	const held = $derived(c?.mode === 'held');
	const free = $derived(c?.mode === 'depositFree');

	// ---- live numbers ------------------------------------------------------------------------
	const OUT_STATES = ['released', 'in_free_time', 'in_detention'];
	const preRelease = $derived(
		!!c && ['requested', 'awaiting_deposit', 'deposit_held', 'authorized'].includes(c.state)
	);
	const isOut = $derived(!!c && OUT_STATES.includes(c.state));
	const freeEnd = $derived(c?.freeTimeEndsAt);
	const days = $derived(
		c && freeEnd
			? detentionDaysAt(
					{
						freeTimeEndsAt: freeEnd,
						maxDetentionDays: c.maxDetentionDays,
						returnedAt: c.returnedAt
					},
					clock.value
				)
			: 0
	);
	const accruedNow = $derived.by(() => {
		if (!c) return 0n;
		if (c.state === 'settled') return units(c.accruedUnits);
		return accrued({ days, dailyRateUnits: c.dailyRateUnits, depositUnits: c.depositUnits });
	});
	const running = $derived(!!c && c.state === 'in_detention');
	const nextDayAt = $derived(freeEnd ? freeEnd + days * DAY_MS : 0);
	const pulls = $derived((d?.payments ?? []).filter((p) => p.kind === 'detention_pull'));
	const confirmedPulls = $derived(pulls.filter((p) => p.status === 'confirmed'));
	const pulledToday = $derived(
		confirmedPulls
			.filter((p) => p.timestamp > clock.value - DAY_MS)
			.reduce((t, p) => t + units(p.amountUnits), 0n)
	);
	const lastPullAt = $derived(
		confirmedPulls.length ? Math.max(...confirmedPulls.map((p) => p.timestamp)) : 0
	);
	const dailyCap = $derived(units(key?.dailyLimitUnits ?? c?.dailyRateUnits ?? '0'));
	const trail = $derived(d ? buildTrail(d) : []);
	const hasRefusal = $derived((d?.payments ?? []).some(isRefusedPull));
	const windowEnd = $derived(c?.settlementWindowEndsAt);
	const windowOpen = $derived(!!windowEnd && clock.value < windowEnd);
	const settleDue = $derived(
		!!c && c.state === 'returned' && !!windowEnd && clock.value >= windowEnd
	);

	const statePill = $derived<ContainerState>(c ? c.state : 'requested');
	const settledMs = $derived(c?.settledAt && c.returnedAt ? c.settledAt - c.returnedAt : null);

	// ---- actions -----------------------------------------------------------------------------
	let tab = $state<'memo' | 'charges' | 'key' | 'details'>('memo');
	let receiptOpen = $state(false);
	let disputeOpen = $state(false);
	let settleBusy = $state<'accept' | 'settle' | 'contest' | null>(null);
	let settleError = $state('');
	type Pull = Awaited<ReturnType<typeof demo.trySecondPull>>;
	let lastPull = $state<Pull>(null);

	async function run(kind: 'accept' | 'settle' | 'contest') {
		if (!c || settleBusy) return;
		settleBusy = kind;
		settleError = '';
		try {
			if (kind === 'contest') {
				await contest({ containerId: c._id });
				toast.success('Return receipt contested', {
					description: 'The importer is told. Record the correct return to continue.'
				});
			} else {
				const r = await (kind === 'accept' ? accept : triggerSettle)({ containerId: c._id });
				toast.protocol(r.status === 'disputed' ? 'Settled, disputed amount held' : 'Settled', {
					description: `${formatMoney(units(r.chargeUnits ?? '0'))} to ${c.lineName}${
						units(r.refundUnits ?? '0') > 0n
							? `, ${formatMoney(units(r.refundUnits ?? '0'))} refunded to ${c.importerName}`
							: ''
					}`,
					txHash: r.txHash ? app.displayHash(r.txHash) : undefined,
					finalityMs: r.finalityMs
				});
			}
		} catch (e) {
			settleError = errorMessage(e);
		} finally {
			settleBusy = null;
		}
	}

	useDemoPageActions(() => {
		if (!app.isSim || !c) return [];
		const acts = [];
		if ((c.state === 'in_free_time' || c.state === 'released') && c.freeTimeEndsAt) {
			acts.push({
				id: 'jump',
				label: 'Jump to end of free time',
				hint: 'Starts detention for this container',
				busy: demo.busy === 'jump',
				onclick: () => demo.jumpToFreeTimeEnd(c._id)
			});
		}
		acts.push({
			id: 'day',
			label: 'Advance 1 day',
			hint: 'Runs every step that becomes due',
			busy: demo.busy === 'advance',
			onclick: () => demo.advanceClock(DAY_MS)
		});
		if (isLine && c.mode === 'depositFree' && c.state === 'in_detention') {
			acts.push({
				id: 'second',
				label: 'Try a second pull today',
				hint: 'The chain should refuse it',
				busy: demo.busy === 'second',
				onclick: async () => {
					const r = await demo.trySecondPull(c._id);
					if (r) {
						lastPull = r;
						tab = 'memo';
					}
				}
			});
		}
		return acts;
	});

	// ---- tables ------------------------------------------------------------------------------
	const chargeColumns: TableColumn[] = [
		{ key: 'item', label: 'Charge' },
		{ key: 'basis', label: 'Basis', hideBelow: 'sm' },
		{ key: 'amount', label: 'Amount', numeric: true },
		{ key: 'status', label: 'Status' }
	];
	type ChargeRow = {
		id: string;
		item: string;
		basis: string;
		amount: bigint;
		status: string;
		tone?: 'danger' | 'positive';
	};
	const chargeRows = $derived.by<ChargeRow[]>(() => {
		if (!c) return [];
		const settled = c.state === 'settled' || c.state === 'disputed';
		const rows: ChargeRow[] = [];
		const det = settled ? units(c.accruedUnits) : accruedNow;
		const detDays = settled ? c.detentionDays : days;
		rows.push({
			id: 'detention',
			item: 'Detention',
			basis:
				detDays > 0
					? `${formatDays(detDays)} at ${formatMoney(units(c.dailyRateUnits))} per day`
					: `After ${formatDays(c.freeDays)} of free time`,
			amount: det,
			status: settled ? 'Final' : running ? 'Accruing' : detDays > 0 ? 'Final' : 'None yet'
		});
		const damage = units(c.damageUnits ?? d?.preview?.damageUnits ?? '0');
		rows.push({
			id: 'damage',
			item: 'Damage',
			basis: c.chargeNote ?? 'Stated by the line when posting charges',
			amount: damage,
			status: c.chargesPostedAt ? 'Posted' : 'Not posted'
		});
		if (c.mode === 'depositFree') {
			rows.push({
				id: 'pulled',
				item: 'Pulled through the access key',
				basis: `${confirmedPulls.length} ${confirmedPulls.length === 1 ? 'pull' : 'pulls'}, one per day`,
				amount: units(c.pulledUnits),
				status: 'Collected'
			});
		} else {
			const total = c.chargesUnits
				? units(c.chargesUnits)
				: units(d?.preview?.maxChargeUnits ?? '0');
			rows.push({
				id: 'total',
				item: 'Total charge to the line',
				basis: 'Never more than the deposit',
				amount: total,
				status: c.state === 'settled' || c.state === 'disputed' ? 'Settled' : 'If settled now'
			});
			const refund = c.refundUnits ? units(c.refundUnits) : units(d?.preview?.refundUnits ?? '0');
			rows.push({
				id: 'refund',
				item: 'Refund to the importer',
				basis: 'The remainder of the deposit',
				amount: refund,
				status: c.state === 'settled' || c.state === 'disputed' ? 'Refunded' : 'If settled now',
				tone: 'positive'
			});
		}
		if (d?.dispute) {
			rows.push({
				id: 'disputed',
				item: 'Disputed amount',
				basis: d.dispute.status === 'open' ? 'Held by the settlement contract' : 'Resolved',
				amount: units(d.dispute.disputedUnits),
				status: 'Disputed',
				tone: 'danger'
			});
		}
		return rows;
	});

	const tabItems = $derived([
		{ value: 'memo' as const, label: 'Memo trail', count: trail.length },
		{ value: 'charges' as const, label: 'Charges' },
		...(free ? [{ value: 'key' as const, label: 'Access key' }] : []),
		{ value: 'details' as const, label: 'Details' }
	]);

	const termsRows = $derived(
		c && d
			? [
					['Free time', formatDays(c.freeDays)],
					['Detention per day', formatMoney(units(c.dailyRateUnits))],
					[held ? 'Deposit' : 'Maximum pulled', formatMoney(units(c.depositUnits))],
					['Maximum detention days', formatDays(c.maxDetentionDays)],
					['Settlement window', formatDays(d.terms.settlementWindowDays)]
				]
			: []
	);
</script>

<svelte:head
	><title>{c ? formatContainerNumber(c.number) : 'Container'} · Portunus</title></svelte:head
>

{#if ref.error}
	<PageHeader
		title="Container"
		breadcrumbs={[{ label: 'Containers', href: '/containers' }, { label: 'Container' }]}
	/>
	<Card padding="lg">
		<EmptyState
			tone="error"
			title="Could not load this container"
			description={errorMessage(ref.error)}
		>
			{#snippet actions()}
				<Button variant="secondary" onclick={() => location.reload()}>Try again</Button>
			{/snippet}
		</EmptyState>
	</Card>
{:else if ref.loading || (ref.detail === undefined && ref.found)}
	<PageHeader
		title="Container"
		breadcrumbs={[
			{ label: 'Containers', href: '/containers' },
			{ label: formatContainerNumber(decodeURIComponent(page.params.number ?? '')) }
		]}
	/>
	<div class="summary">
		{#each [0, 1, 2] as i (i)}
			<Card><Skeleton lines={4} /></Card>
		{/each}
	</div>
	<Card class="mt"><Skeleton lines={6} /></Card>
{:else if !d || !c}
	<PageHeader
		title="Container"
		breadcrumbs={[{ label: 'Containers', href: '/containers' }, { label: 'Not found' }]}
	/>
	<Card padding="lg">
		<EmptyState
			icon={FileQuestion}
			title="Container not found"
			description="Check the number. You can only open containers on your own requests, or ones in a dispute you resolve."
		>
			{#snippet actions()}
				<Button variant="secondary" href="/containers">Back to containers</Button>
			{/snippet}
		</EmptyState>
	</Card>
{:else}
	<PageHeader
		title={c.number}
		subtitle="B/L {c.billOfLading} · {c.lineName} to {c.importerName} · {d.request.portOfDischarge}"
		breadcrumbs={[
			{ label: 'Containers', href: '/containers' },
			{ label: formatContainerNumber(c.number) }
		]}
	>
		{#snippet titleSnippet()}
			<ContainerNumber value={c.number} type={c.type} size="lg" copyable />
		{/snippet}
		{#snippet meta()}
			<StatusPill state={statePill} long size="lg" />
			{#if c.pendingOnChainFlag}<StatusPill state="pending_onchain" size="lg" />{/if}
			<ModeBadge mode={c.mode} />
		{/snippet}
		{#snippet actions()}
			{#if isImporter && isOut}
				<Button
					variant="secondary"
					icon={PackageCheck}
					onclick={() => (receiptOpen = true)}
					data-testid="submit-receipt-open"
				>
					Submit return receipt
				</Button>
			{:else if isLine && isOut}
				<Button variant="secondary" icon={PackageCheck} href="/line/returns">Record return</Button>
			{:else if isLine && c.state === 'returned'}
				<Button variant="secondary" icon={Scale} href="/line/returns"
					>Post charges and settle</Button
				>
			{/if}
		{/snippet}
	</PageHeader>

	<div class="page">
		<!-- Settlement summary -->
		{#if c.state === 'settled'}
			<Card>
				<div class="settled" data-testid="settlement-summary">
					<div class="s-lead">
						<span class="s-icon" aria-hidden="true"
							><CircleCheck size={20} strokeWidth={1.9} /></span
						>
						<div>
							<h2 class="s-title">Settled</h2>
							<p class="s-sub">
								{c.settledAt ? formatDateTime(c.settledAt) : ''}
								{#if free}· Access key revoked{/if}
							</p>
						</div>
					</div>
					<dl class="s-figs">
						<div>
							<dt>{free ? 'Detention collected' : 'Charges to the line'}</dt>
							<dd>
								<Money
									amount={units(free ? c.pulledUnits : (c.chargesUnits ?? '0'))}
									size="xl"
									dimCents
								/>
							</dd>
						</div>
						{#if held}
							<div>
								<dt>Refunded to the importer</dt>
								<dd>
									<Money amount={units(c.refundUnits ?? '0')} size="xl" tone="positive" dimCents />
								</dd>
							</div>
						{/if}
						{#if held && settledMs !== null}
							<div>
								<dt>Return to refund</dt>
								<dd class="figure" data-testid="refund-time">{formatRefundTime(settledMs)}</dd>
							</div>
						{/if}
					</dl>
					<div class="s-tags">
						{#if held}<TempoTag feature="refund_seconds" size="sm" />{/if}
						{#if held}<TempoTag feature="recovery_authority" size="sm" />{/if}
						{#if free}<TempoTag feature="key_revoked" size="sm" />{/if}
					</div>
				</div>
			</Card>
		{/if}

		<!-- Settlement window (returned) -->
		{#if c.state === 'returned' || c.state === 'settling'}
			<Card
				title="Settlement window"
				description={c.state === 'settling'
					? 'Settling on-chain.'
					: 'The line posts final charges inside the window. At its end the remainder refunds automatically.'}
			>
				{#snippet actions()}
					{#if c.returnReceipt?.submittedBy === 'importer'}
						<Badge tone={c.returnReceipt.contested ? 'danger' : 'warning'} dot>
							{c.returnReceipt.contested ? 'Receipt contested' : 'Receipt submitted by importer'}
						</Badge>
					{/if}
				{/snippet}
				<div class="win" data-testid="settlement-window">
					<div class="win-clock">
						{#if windowEnd}
							<ProductCountdown
								start={c.returnedAt}
								target={windowEnd}
								label={windowOpen ? 'Refund proceeds automatically in' : 'Window ended'}
								elapsedLabel="Window ended"
								showTarget
								size="lg"
							/>
						{/if}
					</div>
					<dl class="win-facts">
						{#if c.returnReceipt}
							<div>
								<dt>Return receipt</dt>
								<dd class="mono">{c.returnReceipt.eirNumber}</dd>
								<dd class="sub">{c.returnReceipt.depot}, {formatDate(c.returnReceipt.date)}</dd>
							</div>
						{/if}
						<div>
							<dt>Accrued detention</dt>
							<dd><Money amount={accruedNow} size="md" /></dd>
							<dd class="sub">{formatDays(days)} at {formatMoney(units(c.dailyRateUnits))}</dd>
						</div>
						<div>
							<dt>Damage posted</dt>
							<dd><Money amount={units(c.damageUnits ?? '0')} size="md" /></dd>
							<dd class="sub">{c.chargesPostedAt ? 'Posted by the line' : 'Nothing posted'}</dd>
						</div>
						{#if held && d.preview}
							<div>
								<dt>Refund if settled now</dt>
								<dd><Money amount={units(d.preview.refundUnits)} size="md" tone="positive" /></dd>
							</div>
						{/if}
					</dl>
				</div>

				{#if settleError}
					<Notice tone="danger" title="That did not go through" data-testid="settle-error"
						>{settleError}</Notice
					>
				{/if}

				{#if isImporter && c.state === 'returned'}
					<div class="win-actions">
						{#if c.chargesPostedAt && !settleDue}
							<Button
								variant="accent"
								icon={ShieldCheck}
								loading={settleBusy === 'accept'}
								onclick={() => run('accept')}
								data-testid="accept-charges"
							>
								Accept charges and settle
							</Button>
						{/if}
						{#if settleDue}
							<Button
								variant="accent"
								icon={Scale}
								loading={settleBusy === 'settle'}
								onclick={() => run('settle')}
								data-testid="settle-now"
							>
								Settle now
							</Button>
						{/if}
						{#if held && !d.dispute && windowOpen}
							<Button
								variant="secondary"
								icon={Flag}
								onclick={() => (disputeOpen = true)}
								data-testid="dispute-open"
							>
								Dispute charges
							</Button>
						{/if}
						<p class="win-note">
							{#if settleDue}
								The window has ended. Anyone can trigger the settlement.
							{:else if c.chargesPostedAt}
								Accept to settle now, or dispute once. Disputed funds stay held; the rest settles
								immediately.
							{:else}
								No extra charges posted yet. If none are posted, accrued detention settles at the
								end of the window.
							{/if}
						</p>
					</div>
				{:else if c.state === 'returned'}
					<div class="win-actions">
						{#if settleDue}
							<Button
								variant="accent"
								icon={Scale}
								loading={settleBusy === 'settle'}
								onclick={() => run('settle')}
								data-testid="settle-now"
							>
								Settle now
							</Button>
						{/if}
						{#if isLine && c.returnReceipt?.submittedBy === 'importer' && !c.returnReceipt.contested && windowOpen}
							<Button
								variant="secondary"
								loading={settleBusy === 'contest'}
								onclick={() => run('contest')}
							>
								Contest receipt
							</Button>
						{/if}
					</div>
				{/if}
			</Card>
		{/if}

		<!-- Dispute -->
		{#if d.dispute}
			{@const x = d.dispute}
			<Card title="Dispute" description="Disputed funds stay held by the settlement contract.">
				{#snippet actions()}
					<Badge tone={x.status === 'open' ? 'danger' : 'success'} dot>
						{x.status === 'open' ? 'Open' : 'Resolved'}
					</Badge>
				{/snippet}
				<div class="dispute" data-testid="dispute-card">
					<dl class="win-facts">
						<div>
							<dt>Disputed</dt>
							<dd><Money amount={units(x.disputedUnits)} size="lg" tone="negative" /></dd>
						</div>
						<div>
							<dt>Opened</dt>
							<dd>{formatDateTime(x.openedAt)}</dd>
						</div>
						{#if x.decision}
							<div>
								<dt>Decision</dt>
								<dd>
									<Money amount={units(x.decision.toLineUnits)} size="md" /> to the line,
									<Money amount={units(x.decision.toImporterUnits)} size="md" tone="positive" /> to the
									importer
								</dd>
								<dd class="sub">{x.decision.note}</dd>
							</div>
						{/if}
					</dl>
					<p class="reason"><span class="reason-k">Reason</span> {x.reason}</p>
					<Button variant="secondary" size="sm" href="/disputes" icon={Gavel}
						>Open in disputes</Button
					>
				</div>
			</Card>
		{/if}

		<!-- Refusal callout (demo moment) -->
		{#if lastPull}
			{#if lastPull.refused}
				<Notice
					tone="danger"
					title="Refused by the chain: {lastPull.error}"
					icon={Ban}
					data-testid="refusal-callout"
				>
					The line tried to pull {formatMoney(units(lastPull.attemptedUnits))} again for day {lastPull.day}.
					The access key's one-day limit allows {formatMoney(units(lastPull.remainingUnits))} more until
					it resets {formatDateTime(lastPull.periodEnd)}.
					{#snippet actions()}
						<TempoTag feature="recurring_limit" size="sm" />
					{/snippet}
				</Notice>
			{:else}
				<Notice tone="warning" title="The extra pull went through">Day {lastPull.day}.</Notice>
			{/if}
		{/if}

		<!-- Summary row -->
		<section class="summary" aria-label="Summary">
			<Card title="Free time">
				{#if preRelease}
					<p class="big">{formatDays(c.freeDays)}</p>
					<p class="muted">Free time starts when the line issues the release order.</p>
				{:else if c.returnedAt}
					<p class="big">Returned {formatDate(c.returnedAt)}</p>
					<p class="muted">
						{c.detentionDays > 0
							? `${formatDays(c.detentionDays)} of detention`
							: 'Returned within free time, no detention'}
					</p>
				{:else if freeEnd}
					{#if clock.value < freeEnd}
						<ProductCountdown
							start={c.releasedAt}
							target={freeEnd}
							label="Free time ends in"
							showTarget
							size="lg"
						/>
					{:else}
						<ProductCountdown
							target={freeEnd}
							countUp
							label="Free time ended"
							elapsedLabel="In detention for"
							showTarget
							size="lg"
						/>
					{/if}
					<p class="muted free-terms">
						{formatDays(c.freeDays)} free{c.releasedAt ? ` from ${formatDate(c.releasedAt)}` : ''},
						then
						{formatMoney(units(c.dailyRateUnits))} per started day.
					</p>
				{/if}
			</Card>

			<Card title="Detention">
				{#if preRelease}
					<p class="big">{formatMoney(units(c.dailyRateUnits))} <span class="per">per day</span></p>
					<p class="muted">Charged per started day once free time ends.</p>
				{:else}
					{#if held}
						<Meter
							value={accruedNow}
							max={units(c.depositUnits)}
							dailyRate={units(c.dailyRateUnits)}
							label="Accrued detention"
							maxLabel="deposit"
							live={running}
						/>
					{:else}
						<Meter
							value={units(c.pulledUnits)}
							max={units(c.depositUnits)}
							dailyRate={units(c.dailyRateUnits)}
							label="Pulled so far"
							maxLabel="maximum"
							live={running}
						/>
						<div class="today">
							<div class="today-row">
								<span class="today-k">Pulled today</span>
								<Money amount={pulledToday} size="md" />
								<span class="today-of">of {formatMoney(dailyCap)} daily cap</span>
								{#if pulledToday >= dailyCap && dailyCap > 0n}
									<Badge tone="protocol" size="sm">Cap used for today</Badge>
								{/if}
							</div>
							{#if pulledToday > 0n && lastPullAt}
								<p class="muted">
									Limit resets in
									<ProductCountdown target={lastPullAt + DAY_MS} variant="inline" size="sm" />
								</p>
							{/if}
						</div>
					{/if}
					{#if running && nextDayAt && (held || pulledToday === 0n)}
						<p class="muted day-line">
							Day {days}, next day starts in
							<ProductCountdown target={nextDayAt} variant="inline" size="sm" />
						</p>
					{/if}
				{/if}
			</Card>

			<Card title={held ? 'Deposit' : 'Guarantee'}>
				{#if held}
					<Money amount={units(c.receivedUnits)} size="xl" dimCents />
					<p class="muted">
						{#if c.state === 'awaiting_deposit'}
							of {formatMoney(units(c.depositUnits))} required
							{#if units(c.receivedUnits) > 0n}, {formatMoney(units(c.missingUnits))} missing{/if}
						{:else if c.state === 'settled'}
							Settled and refunded
						{:else}
							Held by the protocol guard
						{/if}
					</p>
					<TempoTag feature="receive_policy" size="sm" />
				{:else}
					<Money amount={dailyCap} size="xl" dimCents />
					<p class="muted">
						{key?.status === 'active'
							? `per day, payable only to ${c.lineName}`
							: key?.status === 'revoked'
								? 'per day, key revoked'
								: 'per day, not authorized yet'}
					</p>
					<p class="muted prose">
						<strong class="nm">No money moves</strong> until a charge is owed.
					</p>
					{#if key?.status === 'active'}
						<TempoTag
							feature="access_key"
							variant="callout"
							label="Access key: up to one day's detention per day, payable only to {c.lineName}, expires {formatDate(
								key.expiry
							)}"
						/>
					{:else if key?.status === 'revoked'}
						<TempoTag feature="key_revoked" size="sm" />
					{:else}
						<TempoTag feature="access_key" size="sm" />
					{/if}
				{/if}
			</Card>
		</section>

		<!-- Tabs -->
		<Tabs items={tabItems} bind:value={tab} label="Container sections">
			{#snippet panel(v)}
				{#if v === 'memo'}
					<Card
						title="Memo trail"
						description="Every payment with its memo, finality time and transaction hash."
					>
						<div class="tags">
							<TempoTag feature="memo" size="sm" />
							{#if hasRefusal && !lastPull?.refused}<TempoTag
									feature="recurring_limit"
									size="sm"
								/>{/if}
						</div>

						{#if trail.length === 0}
							<EmptyState
								compact
								icon={ShieldCheck}
								title="Nothing on the trail yet"
								description="Deposits, pulls, charges and refunds appear here with their memos."
							/>
						{:else}
							<div data-testid="memo-trail">
								<Timeline entries={trail} order="newest" label="Memo trail for {c.number}" />
							</div>
						{/if}
					</Card>
				{:else if v === 'charges'}
					<Card title="Charges" description="How the final charge and the refund are worked out.">
						<Table
							framed={false}
							columns={chargeColumns}
							rows={chargeRows}
							rowKey={(r) => r.id}
							caption="Charges and refund"
						>
							{#snippet cell(r, col)}
								{#if col.key === 'item'}
									<span class="strong">{r.item}</span>
								{:else if col.key === 'basis'}
									<span class="muted">{r.basis}</span>
								{:else if col.key === 'amount'}
									<Money
										amount={r.amount}
										size="sm"
										tone={r.tone === 'positive'
											? 'positive'
											: r.tone === 'danger'
												? 'negative'
												: 'default'}
									/>
								{:else if col.key === 'status'}
									{#if r.id === 'disputed'}
										<StatusPill state="disputed" />
									{:else}
										<span class="muted">{r.status}</span>
									{/if}
								{/if}
							{/snippet}
						</Table>
						<p class="rule">{d.terms.detentionRule}</p>
					</Card>
				{:else if v === 'key' && key}
					<Card
						title="Access key"
						description="A recurring, recipient-scoped, expiring limit on the importer's own account."
					>
						{#snippet actions()}
							<TempoTag feature="access_key" size="sm" />
						{/snippet}
						<dl class="kv">
							<div>
								<dt>Status</dt>
								<dd>
									<Badge
										tone={key.status === 'active'
											? 'protocol'
											: key.status === 'revoked'
												? 'neutral'
												: 'warning'}
										dot
									>
										{key.status === 'active'
											? 'Active'
											: key.status === 'revoked'
												? 'Revoked'
												: 'Prepared'}
									</Badge>
								</dd>
							</div>
							<div>
								<dt>Key</dt>
								<dd><Hash value={key.keyAddress} kind="key" size="sm" /></dd>
							</div>
							<div>
								<dt>Daily cap</dt>
								<dd>
									<Money amount={units(key.dailyLimitUnits)} size="md" />
									<span class="sub">per day, resets daily</span>
								</dd>
							</div>
							<div>
								<dt>Remaining today</dt>
								<dd>
									<Money amount={dailyCap > pulledToday ? dailyCap - pulledToday : 0n} size="md" />
								</dd>
							</div>
							<div>
								<dt>Payable only to</dt>
								<dd>{c.lineName} <Hash value={key.recipient} kind="address" size="sm" /></dd>
							</div>
							<div>
								<dt>Expires</dt>
								<dd>{formatDate(key.expiry)}</dd>
							</div>
							{#if key.authorizedAt}<div>
									<dt>Authorized</dt>
									<dd>{formatDateTime(key.authorizedAt)}</dd>
								</div>{/if}
							{#if key.revokedAt}<div>
									<dt>Revoked</dt>
									<dd>
										{formatDateTime(key.revokedAt)}
										<TempoTag feature="key_revoked" size="sm" />
									</dd>
								</div>{/if}
						</dl>
						{#if key.status === 'revoked'}
							<Notice tone="info"
								>This key is revoked. {c.lineName} can no longer pull from this account for this container.</Notice
							>
						{:else if isImporter && key.status === 'active'}
							<div class="key-act">
								<RevokeKeyButton
									containerId={c._id}
									number={c.number}
									lineName={c.lineName}
									dailyLimitUnits={key.dailyLimitUnits}
								/>
							</div>
						{/if}
					</Card>
				{:else if v === 'details'}
					<Card title="Details">
						<dl class="kv">
							<div>
								<dt>Virtual deposit address</dt>
								<dd class="addr">
									<Hash value={c.depositAddress} kind="address" size="sm" />
									<TempoTag feature="virtual_address" size="sm" />
								</dd>
							</div>
							<div>
								<dt>Release request</dt>
								<dd>
									<span class="mono">{c.billOfLading}</span>
									<span class="sub">{c.requestCode}</span>
								</dd>
							</div>
							<div>
								<dt>Port</dt>
								<dd>
									{d.request.portOfDischarge}{d.request.vessel
										? ` · ${d.request.vessel}${d.request.voyage ? ' ' + d.request.voyage : ''}`
										: ''}
								</dd>
							</div>
							{#each termsRows as [k, v2] (k)}
								<div>
									<dt>{k}</dt>
									<dd>{v2}</dd>
								</div>
							{/each}
							{#if c.returnReceipt}
								<div>
									<dt>Return receipt</dt>
									<dd>
										<span class="mono">{c.returnReceipt.eirNumber}</span>
										<span class="sub"
											>{c.returnReceipt.depot}, {formatDate(c.returnReceipt.date)}, recorded by the {c
												.returnReceipt.submittedBy}</span
										>
									</dd>
								</div>
							{/if}
							{#if windowEnd}
								<div>
									<dt>Settlement window ends</dt>
									<dd>
										{formatDateTime(windowEnd)}
										{#if c.state === 'returned'}<ProductCountdown
												target={windowEnd}
												variant="inline"
												size="sm"
											/>{/if}
									</dd>
								</div>
							{/if}
						</dl>
						<p class="rule">{held ? d.terms.refundRule : d.terms.refundRule}</p>
						{#if held}<p class="rule">{d.terms.disputeRule}</p>{/if}
					</Card>
				{/if}
			{/snippet}
		</Tabs>

		<p class="foot">
			<KeyRound size={12} strokeWidth={1.75} aria-hidden="true" />
			Reads from memos and settlement events. Same record for the line and the importer.
		</p>
	</div>

	{#if isImporter}
		<ReturnReceiptModal
			bind:open={receiptOpen}
			containerId={c._id}
			number={c.number}
			releasedAt={c.releasedAt}
			windowDays={d.terms.settlementWindowDays}
			graceHours={d.terms.silentGraceHours}
		/>
		<DisputeModal
			bind:open={disputeOpen}
			containerId={c._id}
			number={c.number}
			maxUnits={d.preview?.maxChargeUnits ?? c.depositUnits}
		/>
	{/if}
{/if}

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	:global(.mt) {
		margin-top: var(--space-4);
	}

	.summary {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-4);
	}
	.big {
		margin: 0;
		font-size: var(--text-2xl);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-snug);
		font-variant-numeric: tabular-nums;
	}
	.per {
		font-size: var(--text-base);
		font-weight: var(--weight-regular);
		color: var(--color-text-secondary);
	}
	.muted {
		margin: var(--space-1) 0 var(--space-2);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1-5);
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}
	/* a sentence, not a flex row: the flex gap plus the space doubled the gap before "until" */
	.prose {
		display: block;
	}
	.nm {
		color: var(--color-text);
		font-weight: var(--weight-medium);
	}
	.today {
		margin-top: var(--space-4);
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-border-subtle);
	}
	.today-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1-5) var(--space-2);
	}
	.today-k {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}
	.today-of {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}
	.day-line {
		margin-top: var(--space-3);
	}
	.free-terms {
		margin-top: var(--space-4);
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-border-subtle);
	}

	.settled {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: var(--space-4) var(--space-8);
	}
	.s-lead {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.s-icon {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: var(--radius-lg);
		background: var(--tone-success-bg);
		color: var(--tone-success-fg);
	}
	.s-title {
		margin: 0;
		font-size: var(--text-xl);
		font-weight: var(--weight-semibold);
	}
	.s-sub {
		margin: var(--space-0-5) 0 0;
		color: var(--color-text-secondary);
	}
	.s-figs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4) var(--space-10);
		margin: 0;
	}
	.s-figs dt,
	.win-facts dt,
	.kv dt {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
		margin-bottom: var(--space-1);
	}
	.s-figs dd,
	.win-facts dd,
	.kv dd {
		margin: 0;
	}
	.figure {
		font-size: var(--text-3xl);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tight);
		font-variant-numeric: tabular-nums;
		color: var(--tone-success-fg);
	}
	.s-tags {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.win {
		display: grid;
		grid-template-columns: minmax(0, 18rem) minmax(0, 1fr);
		gap: var(--space-6);
		align-items: start;
	}
	.win-facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: var(--space-4);
		margin: 0;
	}
	.sub {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}
	.win-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-5);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border-subtle);
	}
	.win-note {
		flex-basis: 100%;
		margin: 0;
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}
	:global(.win ~ .notice) {
		margin-top: var(--space-4);
	}

	.dispute {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		align-items: flex-start;
	}
	.reason {
		margin: 0;
		color: var(--color-text-secondary);
	}
	.reason-k {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
		margin-right: var(--space-1);
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}
	.strong {
		font-weight: var(--weight-medium);
	}
	.rule {
		margin: var(--space-4) 0 0;
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
		line-height: var(--leading-xs);
	}
	.kv {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-4) var(--space-6);
		margin: 0;
	}
	.kv dd {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1-5) var(--space-2);
	}
	.addr {
		flex-wrap: wrap;
	}
	.key-act {
		margin-top: var(--space-4);
	}
	.foot {
		display: flex;
		align-items: center;
		gap: var(--space-1-5);
		margin: 0;
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	@media (max-width: 1100px) {
		.summary {
			grid-template-columns: minmax(0, 1fr);
		}
		.win {
			grid-template-columns: minmax(0, 1fr);
		}
		.settled {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 760px) {
		.kv {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
