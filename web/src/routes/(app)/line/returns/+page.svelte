<script lang="ts">
	/**
	 * Returns and settlement (details 11.7 and section 9, DESIGN 11.8): containers that are out,
	 * recording the empty's return receipt, then settling inside the window. Settlement releases
	 * the deposit from the protocol guard: charges to the line, the remainder to the importer.
	 */
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import PackageOpen from '@lucide/svelte/icons/package-open';
	import ReceiptText from '@lucide/svelte/icons/receipt-text';
	import Search from '@lucide/svelte/icons/search';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Layers from '@lucide/svelte/icons/layers';
	import Flag from '@lucide/svelte/icons/flag';
	import {
		Badge,
		Button,
		Card,
		Checkbox,
		ContainerNumber,
		EmptyState,
		Input,
		Money,
		PageHeader,
		SegmentedControl,
		StatusPill,
		Table,
		Tabs,
		TempoTag,
		formatContainerNumber,
		formatDate,
		formatDuration,
		formatMoney,
		toast,
		type TableColumn
	} from '#lib/ui';
	import { useAuthedAction, useAuthedQuery } from '#lib/backend';
	import {
		ChainResult,
		ModeBadge,
		ProductCountdown,
		api,
		containerHref,
		errorMessage,
		units,
		useApp,
		useDemoActions,
		useDemoPageActions
	} from '#lib/app';
	import { accrued, detentionDaysAt, settlementAmounts } from '#lib/shared/domain/rules.ts';
	import { useNarrow } from '#lib/app/line/useNarrow.svelte.ts';
	import RecordReturnDrawer from '#lib/app/line/RecordReturnDrawer.svelte';
	import SettleDrawer from '#lib/app/line/SettleDrawer.svelte';
	import type { LineContainer } from '#lib/app/line/lineStatus.ts';

	const narrow = useNarrow();
	const app = useApp();
	const demo = useDemoActions();
	const list = useAuthedQuery(api.containers.listForLine, {});
	const settleMany = useAuthedAction(api.containers.settleMany);

	type Tab = 'out' | 'window' | 'settled';
	type OutFilter = 'all' | 'in_free_time' | 'in_detention';
	let tab = $state<Tab>('out');
	let outFilter = $state<OutFilter>('all');
	let search = $state('');

	const all = $derived(list.data ?? []);
	const q = $derived(search.replace(/\s+/g, '').toUpperCase());
	const matches = (c: LineContainer) =>
		!q || c.number.includes(q) || c.importerName.replace(/\s+/g, '').toUpperCase().includes(q);

	const OUT = ['released', 'in_free_time', 'in_detention'];
	const WINDOW = ['returned', 'settling', 'disputed'];
	const out = $derived(all.filter((c) => OUT.includes(c.state)));
	const inWindow = $derived(
		all
			.filter((c) => WINDOW.includes(c.state))
			.sort((a, b) => (a.settlementWindowEndsAt ?? 0) - (b.settlementWindowEndsAt ?? 0))
	);
	const settled = $derived(
		all.filter((c) => c.state === 'settled').sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0))
	);
	const outRows = $derived(
		out
			.filter((c) => matches(c))
			.filter(
				(c) =>
					outFilter === 'all' ||
					(outFilter === 'in_detention' ? c.state === 'in_detention' : c.state !== 'in_detention')
			)
			.sort((a, b) => (a.freeTimeEndsAt ?? 0) - (b.freeTimeEndsAt ?? 0))
	);
	const windowRows = $derived(inWindow.filter(matches));
	const settledRows = $derived(settled.filter(matches).slice(0, 50));

	const tabs = $derived([
		{ value: 'out' as const, label: 'Awaiting return', count: out.length },
		{ value: 'window' as const, label: 'In settlement window', count: inWindow.length },
		{ value: 'settled' as const, label: 'Settled', count: settled.length }
	]);

	// ---- row figures -------------------------------------------------------------------------
	function figures(c: LineContainer) {
		if (c.freeTimeEndsAt === undefined)
			return { days: 0, accrued: 0n, refund: units(c.receivedUnits) };
		const days = detentionDaysAt(
			{
				freeTimeEndsAt: c.freeTimeEndsAt,
				maxDetentionDays: c.maxDetentionDays,
				returnedAt: c.returnedAt
			},
			app.now()
		);
		const acc = accrued({ days, dailyRateUnits: c.dailyRateUnits, depositUnits: c.depositUnits });
		if (c.mode !== 'held') return { days, accrued: acc, refund: 0n };
		const a = settlementAmounts({
			heldUnits: units(c.receivedUnits),
			depositUnits: c.depositUnits,
			accruedUnits: acc,
			damageUnits: units(c.damageUnits)
		});
		return { days, accrued: acc, refund: a.refundUnits };
	}

	// ---- drawers --------------------------------------------------------------------------------
	let recordOpen = $state(false);
	let recordId = $state<string>();
	const recordFor = $derived(all.find((c) => c._id === recordId));
	let settleOpen = $state(false);
	let settleId = $state<string>();
	let settleContest = $state(false);
	const settleFor = $derived(all.find((c) => c._id === settleId));

	function openRecord(c: LineContainer) {
		recordId = c._id;
		recordOpen = true;
	}
	function openSettle(id: string, contest = false) {
		settleId = id;
		settleContest = contest;
		settleOpen = true;
	}
	function onRecorded(id: string) {
		tab = 'window';
		search = '';
		openSettle(id);
	}

	// ---- batch settlement ---------------------------------------------------------------------------
	let selected = $state<string[]>([]);
	const selectable = $derived(windowRows.filter((c) => c.state === 'returned'));
	const selectedLive = $derived(selected.filter((id) => selectable.some((c) => c._id === id)));
	const allSelected = $derived(selectable.length > 0 && selectedLive.length === selectable.length);
	const someSelected = $derived(selectedLive.length > 0 && !allSelected);
	function toggle(id: string) {
		selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
	}
	function toggleAll() {
		selected = allSelected ? [] : selectable.map((c) => c._id);
	}

	type Batch = Awaited<ReturnType<typeof settleMany>>;
	let batchBusy = $state(false);
	let batchError = $state('');
	let batch = $state<Batch | null>(null);
	async function runBatch() {
		if (batchBusy || selectedLive.length === 0) return;
		batchBusy = true;
		batchError = '';
		batch = null;
		try {
			batch = await settleMany({ containerIds: selectedLive as never });
			selected = [];
			if (!batch.txHash) {
				toast.success(`${batch.settled} settled`, {
					description: batch.skipped ? `${batch.skipped} skipped.` : undefined
				});
			}
		} catch (e) {
			batchError = errorMessage(e);
			toast.error('Batch settlement failed', { description: batchError });
		} finally {
			batchBusy = false;
		}
	}

	// ---- demo ---------------------------------------------------------------------------------------
	const firstInFree = $derived(out.find((c) => c.state === 'in_free_time'));
	useDemoPageActions(() =>
		app.isSim && firstInFree
			? [
					{
						id: 'jump-free-time',
						label: 'Jump to end of free time',
						hint: firstInFree.number,
						busy: demo.busy === 'jump',
						onclick: () => demo.jumpToFreeTimeEnd(firstInFree._id)
					}
				]
			: []
	);

	// ---- columns --------------------------------------------------------------------------------------
	const outCols: TableColumn[] = [
		{ key: 'container', label: 'Container' },
		{ key: 'importer', label: 'Importer', hideBelow: 'lg' },
		{ key: 'mode', label: 'Mode', hideBelow: 'lg' },
		{ key: 'status', label: 'Status', hideBelow: 'md' },
		{ key: 'time', label: 'Free time', hideBelow: 'sm' },
		{ key: 'accrued', label: 'Accrued', numeric: true, hideBelow: 'md' },
		{
			key: 'action',
			label: 'Action',
			srOnlyLabel: true,
			align: 'right',
			hideBelow: 'md'
		}
	];
	const windowCols: TableColumn[] = [
		{ key: 'select', label: 'Select', srOnlyLabel: true, width: '2.75rem' },
		{ key: 'container', label: 'Container' },
		{ key: 'importer', label: 'Importer', hideBelow: 'lg' },
		{ key: 'receipt', label: 'Return receipt', hideBelow: 'md' },
		{ key: 'accrued', label: 'Accrued', numeric: true, hideBelow: 'sm' },
		{ key: 'refund', label: 'Refund', numeric: true, hideBelow: 'sm' },
		{ key: 'window', label: 'Window ends', width: '8.5rem' },
		{ key: 'action', label: 'Action', srOnlyLabel: true, align: 'right', hideBelow: 'md' }
	];
	const settledCols: TableColumn[] = [
		{ key: 'container', label: 'Container' },
		{ key: 'importer', label: 'Importer', hideBelow: 'lg' },
		{ key: 'mode', label: 'Mode', hideBelow: 'md' },
		{ key: 'settled', label: 'Settled', hideBelow: 'sm' },
		{ key: 'charged', label: 'To the line', numeric: true },
		{ key: 'refunded', label: 'Refunded', numeric: true },
		{ key: 'speed', label: 'Return to refund', numeric: true, hideBelow: 'md' },
		{ key: 'key', label: 'Access key', hideBelow: 'lg' }
	];

	const importerReceipts = $derived(
		inWindow.filter((c) => c.state === 'returned' && c.returnReceipt?.submittedBy === 'importer')
	);
</script>

<svelte:head><title>Returns and settlement · Portunus</title></svelte:head>

<PageHeader
	title="Returns and settlement"
	subtitle="Record empty returns, post charges within the window, settle."
/>

{#if list.error}
	<Card>
		<EmptyState
			tone="error"
			title="Containers did not load"
			description={errorMessage(list.error)}
		/>
	</Card>
{:else}
	<div class="page">
		<div class="toolbar">
			<div class="tabwrap"><Tabs items={tabs} bind:value={tab} label="Returns by stage" /></div>
			<div class="search">
				<Input
					bind:value={search}
					icon={Search}
					type="search"
					placeholder="Search container or importer"
					aria-label="Search containers"
				/>
			</div>
		</div>

		{#if tab === 'out'}
			<div class="filter">
				<SegmentedControl
					size="sm"
					label="Filter containers that are out"
					bind:value={outFilter}
					options={[
						{ value: 'all', label: `All ${out.length}` },
						{ value: 'in_free_time', label: 'In free time' },
						{ value: 'in_detention', label: 'In detention' }
					]}
				/>
			</div>
			{#snippet recordButton(c: LineContainer)}
				<Button
					variant="secondary"
					size="sm"
					icon={PackageCheck}
					onclick={() => openRecord(c)}
					data-testid="record-return-{c.number}"
				>
					Record return
				</Button>
			{/snippet}

			<Table
				caption="Containers out for delivery"
				columns={outCols}
				rows={outRows}
				rowKey={(c) => c._id}
				loading={list.isLoading}
				emptyIcon={PackageOpen}
				emptyTitle={search || outFilter !== 'all' ? 'No containers match' : 'No containers out'}
				emptyDescription={search || outFilter !== 'all'
					? 'Try a different filter or search.'
					: 'Released containers appear here until their empty is returned.'}
			>
				{#snippet cell(c, col)}
					{#if col.key === 'container'}
						<div class="stack">
							<ContainerNumber value={c.number} type={c.type} href={containerHref(c.number)} />
							{#if narrow.value}
								<div class="sub">
									<StatusPill
										state={c.pendingOnChainFlag ? 'pending_onchain' : c.state}
										size="sm"
									/>
									{@render recordButton(c)}
								</div>
							{/if}
						</div>
					{:else if col.key === 'importer'}
						<span class="muted">{c.importerName}</span>
					{:else if col.key === 'mode'}
						<ModeBadge mode={c.mode} size="sm" />
					{:else if col.key === 'status'}
						<StatusPill state={c.pendingOnChainFlag ? 'pending_onchain' : c.state} />
					{:else if col.key === 'time'}
						{#if c.freeTimeEndsAt}
							<ProductCountdown
								target={c.freeTimeEndsAt}
								variant="inline"
								countUp
								showSeconds={false}
							/>
						{/if}
					{:else if col.key === 'accrued'}
						<Money amount={units(c.mode === 'held' ? c.accruedUnits : c.pulledUnits)} />
						<span class="of">of {formatMoney(units(c.depositUnits))}</span>
					{:else if col.key === 'action' && !narrow.value}
						{@render recordButton(c)}
					{/if}
				{/snippet}
			</Table>
		{:else if tab === 'window'}
			<p class="explain">
				Post final charges inside the window, or the window ends and the refund goes out with
				accrued detention and no damage. Anyone can trigger the refund once the window has ended.
			</p>
			{#if importerReceipts.length}
				<Card variant="outline" class="importer-note">
					<div class="inote">
						<Flag size={16} strokeWidth={1.75} aria-hidden="true" />
						<p>
							<strong>
								{importerReceipts.length}
								{importerReceipts.length === 1 ? 'return receipt was' : 'return receipts were'} submitted
								by the importer.
							</strong>
							You did not record them (silent line rule). Contest within the window or the refund proceeds.
						</p>
					</div>
				</Card>
			{/if}

			{#if batch}
				<Card class="batch-result" variant="outline">
					<div class="result">
						<div class="result-head">
							<CircleCheck size={18} strokeWidth={1.75} aria-hidden="true" />
							<strong data-testid="batch-summary"
								>{`${batch.settled} ${batch.settled === 1 ? 'container' : 'containers'} settled${batch.skipped ? `, ${batch.skipped} skipped` : ''}`}</strong
							>
							<TempoTag feature="batch" size="sm" />
						</div>
						{#if batch.txHash}
							<ChainResult
								txHash={batch.txHash}
								finalityMs={batch.finalityMs ?? undefined}
								tag
								toastTitle="Batch transaction settled"
								toastDescription="{batch.settled} containers settled in one transaction."
							/>
						{/if}
						{#each batch.outcomes.filter((o) => o.status !== 'settled') as o (o.containerId)}
							<p class="skip">
								{o.number ? formatContainerNumber(o.number) : 'Container'}: {o.reason ?? 'Skipped.'}
							</p>
						{/each}
					</div>
				</Card>
			{/if}

			{#if selectable.length > 0}
				<div class="batchbar" class:active={selectedLive.length > 0}>
					<Checkbox
						checked={allSelected}
						indeterminate={someSelected}
						onchange={toggleAll}
						label={selectedLive.length ? `${selectedLive.length} selected` : 'Select all'}
					/>
					<div class="batchbar-end">
						{#if selectedLive.length > 0}
							<span class="hint">
								Settles with accrued detention and no damage charge. Open a container to add damage.
							</span>
							<TempoTag feature="batch" size="sm" />
							<Button
								variant="accent"
								icon={Layers}
								loading={batchBusy}
								loadingLabel="Settling"
								onclick={runBatch}
								data-testid="settle-selected"
							>
								Settle {selectedLive.length} selected in one transaction
							</Button>
						{:else}
							<span class="hint">Select returned containers to settle them together.</span>
						{/if}
					</div>
				</div>
				{#if batchError}<p class="err" role="alert">{batchError}</p>{/if}
			{/if}

			{#snippet windowActions(c: LineContainer)}
				<div class="row-actions">
					{#if c.state === 'returned' && c.returnReceipt?.submittedBy === 'importer'}
						<Button
							variant="ghost"
							size="sm"
							onclick={() => openSettle(c._id, true)}
							data-testid="contest-{c.number}"
						>
							Contest
						</Button>
					{/if}
					{#if c.state === 'returned'}
						<Button
							variant="secondary"
							size="sm"
							onclick={() => openSettle(c._id)}
							data-testid="review-{c.number}"
						>
							Review and settle
						</Button>
					{:else if c.state === 'disputed'}
						<Button variant="ghost" size="sm" href="/disputes">View dispute</Button>
					{/if}
				</div>
			{/snippet}

			<Table
				caption="Containers in the settlement window"
				columns={windowCols}
				rows={windowRows}
				rowKey={(c) => c._id}
				loading={list.isLoading}
				emptyIcon={ReceiptText}
				emptyTitle={search ? 'No containers match' : 'No returns waiting'}
				emptyDescription={search
					? 'Try a different search.'
					: 'Record a return and the container waits here for settlement.'}
			>
				{#snippet cell(c, col)}
					{@const f = figures(c)}
					{#if col.key === 'select'}
						{#if c.state === 'returned'}
							<Checkbox
								checked={selected.includes(c._id)}
								onchange={() => toggle(c._id)}
								aria-label="Select {c.number}"
							/>
						{/if}
					{:else if col.key === 'container'}
						<div class="stack">
							<ContainerNumber value={c.number} type={c.type} href={containerHref(c.number)} />
							<span class="sub">
								<ModeBadge mode={c.mode} size="sm" />
								{#if c.state !== 'returned'}
									<StatusPill
										state={c.pendingOnChainFlag ? 'pending_onchain' : c.state}
										size="sm"
									/>
								{/if}
							</span>
							{#if narrow.value && c.state !== 'settling'}
								<div class="sub">{@render windowActions(c)}</div>
							{/if}
						</div>
					{:else if col.key === 'importer'}
						<span class="muted">{c.importerName}</span>
					{:else if col.key === 'receipt'}
						{#if c.returnReceipt}
							<div class="stack">
								<span class="mono">{c.returnReceipt.eirNumber}</span>
								{#if c.returnReceipt.submittedBy === 'importer'}
									<Badge tone="caution" size="sm" dot>Submitted by importer</Badge>
								{:else}
									<span class="sub muted">{c.returnReceipt.depot}</span>
								{/if}
							</div>
						{/if}
					{:else if col.key === 'accrued'}
						{#if c.state === 'disputed'}
							<span class="muted">Held in dispute</span>
						{:else}
							<Money amount={f.accrued} />
							<span class="of">{f.days} {f.days === 1 ? 'day' : 'days'}</span>
						{/if}
					{:else if col.key === 'refund'}
						{#if c.state === 'disputed'}
							<Money amount={units(c.escrowUnits)} />
						{:else if c.mode === 'held'}
							<Money amount={f.refund} tone="positive" />
						{:else}
							<span class="muted">None</span>
						{/if}
					{:else if col.key === 'window'}
						{#if c.settlementWindowEndsAt && c.state === 'returned'}
							<ProductCountdown
								target={c.settlementWindowEndsAt}
								variant="inline"
								showSeconds={false}
								elapsedLabel="Window ended"
							/>
						{:else if c.state === 'disputed'}
							<Badge tone="danger" size="sm" dot>Disputed</Badge>
						{/if}
					{:else if col.key === 'action' && !narrow.value}
						{@render windowActions(c)}
					{/if}
				{/snippet}
			</Table>
		{:else}
			<Table
				caption="Settled containers"
				columns={settledCols}
				rows={settledRows}
				rowKey={(c) => c._id}
				loading={list.isLoading}
				rowHref={(c) => containerHref(c.number)}
				rowLabel={(c) => `Open ${c.number}`}
				emptyIcon={CircleCheck}
				emptyTitle={search ? 'No containers match' : 'Nothing settled yet'}
				emptyDescription={search
					? 'Try a different search.'
					: 'Settled containers and their refunds show up here.'}
			>
				{#snippet cell(c, col)}
					{#if col.key === 'container'}
						<ContainerNumber value={c.number} type={c.type} />
					{:else if col.key === 'importer'}
						<span class="muted">{c.importerName}</span>
					{:else if col.key === 'mode'}
						<ModeBadge mode={c.mode} size="sm" />
					{:else if col.key === 'settled'}
						<span class="muted tabular">{c.settledAt ? formatDate(c.settledAt) : ''}</span>
					{:else if col.key === 'charged'}
						<Money amount={units(c.chargesUnits)} />
					{:else if col.key === 'refunded'}
						{#if c.mode === 'held'}
							<Money amount={units(c.refundUnits)} tone="positive" />
						{:else}
							<span class="muted">None</span>
						{/if}
					{:else if col.key === 'speed'}
						<span class="tabular">
							{c.settledAt && c.returnedAt
								? formatDuration(c.settledAt - c.returnedAt, 'long')
								: ''}
						</span>
					{:else if col.key === 'key'}
						{#if c.mode === 'depositFree'}
							{#if c.accessKey?.revokeRequestedAt && c.accessKey.status !== 'revoked'}
								<Badge tone="warning" size="sm" dot>Revocation requested from importer</Badge>
							{:else if c.accessKey?.status === 'revoked'}
								<Badge tone="success" size="sm" dot>Access key revoked</Badge>
							{:else}
								<span class="muted">Active</span>
							{/if}
						{:else}
							<span class="muted">No key</span>
						{/if}
					{/if}
				{/snippet}
			</Table>
		{/if}
	</div>
{/if}

<RecordReturnDrawer bind:open={recordOpen} container={recordFor} onrecorded={onRecorded} />
<SettleDrawer bind:open={settleOpen} container={settleFor} contest={settleContest} />

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-3);
		border-bottom: 1px solid var(--color-border);
	}

	.tabwrap {
		min-width: 0;
		max-width: 100%;
		overflow-x: auto;
		margin-bottom: -1px;
	}

	.search {
		flex: 0 1 20rem;
		min-width: min(100%, 14rem);
		padding-bottom: var(--space-2);
	}

	.filter {
		display: flex;
	}

	.explain {
		color: var(--color-text-secondary);
		max-width: 52rem;
	}

	.muted {
		color: var(--color-text-secondary);
	}

	.of {
		margin-left: var(--space-1);
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-1-5);
		align-items: flex-start;
	}

	.sub {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-xs);
	}

	.row-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-1);
	}

	.inote {
		display: flex;
		gap: var(--space-3);
		color: var(--tone-caution-fg);
	}

	.inote p {
		color: var(--color-text-secondary);
	}

	.inote strong {
		color: var(--color-text);
		font-weight: var(--weight-semibold);
	}

	.batchbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		transition: border-color var(--duration-base) var(--ease-standard);
	}

	.batchbar.active {
		border-color: var(--color-accent-border);
		background: var(--color-accent-subtle);
	}

	.batchbar-end {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.hint {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}

	.result {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.result-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		color: var(--tone-success-fg);
	}

	.skip,
	.err {
		font-size: var(--text-xs);
		color: var(--tone-danger-fg);
	}
</style>
