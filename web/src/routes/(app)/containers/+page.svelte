<script lang="ts">
	/**
	 * Containers, for both roles. The line sees its importers, the importer sees its lines. The
	 * dispute resolver sees the containers it has been asked to rule on.
	 */
	import Boxes from '@lucide/svelte/icons/boxes';
	import Search from '@lucide/svelte/icons/search';
	import {
		Badge,
		Button,
		Card,
		ContainerNumber,
		EmptyState,
		Input,
		Money,
		PageHeader,
		Select,
		StatusPill,
		Table,
		Tabs,
		formatMoney,
		type TableColumn
	} from '#lib/ui';
	import {
		ModeBadge,
		ProductCountdown,
		STATE_GROUPS,
		api,
		containerHref,
		errorMessage,
		inGroup,
		units,
		useApp,
		type StateGroup
	} from '#lib/app';
	import { useAuthedQuery } from '#lib/backend';

	const app = useApp();
	const isLine = $derived(app.role === 'line');
	const isPlatform = $derived(app.role === 'platform');

	const line = useAuthedQuery(api.containers.listForLine, () => (isLine ? {} : 'skip'));
	const importer = useAuthedQuery(api.containers.listForImporter, () =>
		app.role === 'importer' ? {} : 'skip'
	);
	const disputes = useAuthedQuery(api.disputes.list, () => (isPlatform ? {} : 'skip'));

	const q = $derived(isLine ? line : importer);
	const rows = $derived(isPlatform ? [] : (q.data ?? []));
	const loading = $derived(isPlatform ? disputes.isLoading : q.isLoading);
	const error = $derived(isPlatform ? disputes.error : q.error);

	let group = $state<StateGroup>('all');
	let search = $state('');
	let mode = $state<'all' | 'held' | 'depositFree'>('all');

	const text = $derived(search.trim().toUpperCase().replace(/[\s-]/g, ''));
	const base = $derived(
		rows.filter(
			(c) =>
				(mode === 'all' || c.mode === mode) &&
				(!text ||
					c.number.includes(text) ||
					c.billOfLading.toUpperCase().replace(/[\s-]/g, '').includes(text))
		)
	);
	const shown = $derived(base.filter((c) => inGroup(c.state, group)));
	const tabItems = $derived(
		STATE_GROUPS.map((g) => ({
			value: g.value,
			label: g.label,
			count: base.filter((c) => inGroup(c.state, g.value)).length
		}))
	);

	const columns: TableColumn[] = $derived([
		{ key: 'number', label: 'Container' },
		{ key: 'party', label: isLine ? 'Importer' : 'Line', hideBelow: 'md' },
		{ key: 'mode', label: 'Mode', hideBelow: 'lg' },
		{ key: 'state', label: 'Status' },
		{ key: 'time', label: 'Free time', hideBelow: 'sm' },
		{ key: 'money', label: 'Deposit', numeric: true, hideBelow: 'sm' }
	]);

	// Resolver view: one row per dispute.
	const disputeRows = $derived(
		(disputes.data ?? []).filter(
			(d) =>
				!text || d.containerNumber.includes(text) || d.billOfLading.toUpperCase().includes(text)
		)
	);
	const disputeColumns: TableColumn[] = [
		{ key: 'number', label: 'Container' },
		{ key: 'parties', label: 'Line and importer', hideBelow: 'md' },
		{ key: 'status', label: 'Dispute' },
		{ key: 'amount', label: 'Disputed', numeric: true }
	];
</script>

<svelte:head><title>Containers · Portunus</title></svelte:head>

<PageHeader
	title="Containers"
	subtitle={isPlatform
		? 'Containers with a dispute you are asked to rule on.'
		: isLine
			? 'Every container you have released, by state.'
			: 'Every container on your release requests, by state.'}
/>

{#if error}
	<Card padding="lg">
		<EmptyState tone="error" title="Could not load containers" description={errorMessage(error)}>
			{#snippet actions()}
				<Button variant="secondary" onclick={() => location.reload()}>Try again</Button>
			{/snippet}
		</EmptyState>
	</Card>
{:else if isPlatform}
	<div class="toolbar">
		<div class="search">
			<Input
				bind:value={search}
				icon={Search}
				placeholder="Search container or B/L"
				aria-label="Search containers"
			/>
		</div>
	</div>
	<Table
		columns={disputeColumns}
		rows={disputeRows}
		rowKey={(r) => r._id}
		caption="Containers in dispute"
		rowHref={(r) => containerHref(r.containerNumber)}
		rowLabel={(r) => r.containerNumber}
		{loading}
		emptyTitle="No disputed containers"
		emptyDescription="Containers appear here when a dispute is sent to you."
		emptyIcon={Boxes}
	>
		{#snippet cell(r, col)}
			{#if col.key === 'number'}
				<ContainerNumber value={r.containerNumber} type={r.containerType ?? undefined} size="sm" />
			{:else if col.key === 'parties'}
				{r.lineName} and {r.importerName}
			{:else if col.key === 'status'}
				<Badge tone={r.status === 'open' ? 'danger' : 'success'} dot
					>{r.status === 'open' ? 'Open' : 'Resolved'}</Badge
				>
			{:else if col.key === 'amount'}
				<Money amount={units(r.disputedUnits)} size="sm" />
			{/if}
		{/snippet}
	</Table>
{:else}
	<div class="toolbar">
		<div class="filters">
			<div class="search">
				<Input
					bind:value={search}
					icon={Search}
					placeholder="Search number or B/L"
					aria-label="Search by container number or bill of lading"
				/>
			</div>
			<div class="mode">
				<Select
					bind:value={mode}
					aria-label="Deposit mode"
					options={[
						{ value: 'all', label: 'All modes' },
						{ value: 'held', label: 'Held deposit' },
						{ value: 'depositFree', label: 'Deposit-free' }
					]}
				/>
			</div>
		</div>
	</div>
	<Tabs items={tabItems} bind:value={group} label="Container state" />
	<div class="table">
		<Table
			{columns}
			rows={shown}
			rowKey={(c) => c._id}
			caption="Containers"
			rowHref={(c) => containerHref(c.number)}
			rowLabel={(c) => c.number}
			{loading}
			emptyTitle={rows.length === 0 ? 'No containers yet' : 'No containers match'}
			emptyDescription={rows.length === 0
				? 'Containers appear here as soon as a release request is created.'
				: 'Try another state, mode or search.'}
			emptyIcon={Boxes}
		>
			{#snippet cell(c, col)}
				{#if col.key === 'number'}
					<div class="stack">
						<ContainerNumber value={c.number} type={c.type} size="sm" />
						<span class="sub mono">{c.billOfLading}</span>
					</div>
				{:else if col.key === 'party'}
					{isLine ? c.importerName : c.lineName}
				{:else if col.key === 'mode'}
					<ModeBadge mode={c.mode} size="sm" />
				{:else if col.key === 'state'}
					<div class="stack">
						<StatusPill state={c.pendingOnChainFlag ? 'pending_onchain' : c.state} />
						{#if c.state === 'in_detention'}<span class="sub">Day {c.detentionDays}</span>{/if}
					</div>
				{:else if col.key === 'time'}
					{#if c.state === 'returned' && c.settlementWindowEndsAt}
						<ProductCountdown target={c.settlementWindowEndsAt} variant="inline" label="Window" />
					{:else if c.freeTimeEndsAt && (c.state === 'in_free_time' || c.state === 'released')}
						<ProductCountdown target={c.freeTimeEndsAt} variant="inline" label="Ends in" />
					{:else if c.freeTimeEndsAt && c.state === 'in_detention'}
						<ProductCountdown
							target={c.freeTimeEndsAt}
							variant="inline"
							countUp
							elapsedLabel="Detention"
						/>
					{:else}
						<span class="sub">–</span>
					{/if}
				{:else if col.key === 'money'}
					{#if c.mode === 'held'}
						{#if c.state === 'awaiting_deposit' || c.state === 'requested'}
							<Money amount={units(c.depositUnits)} size="sm" tone="muted" />
						{:else}
							<Money amount={units(c.receivedUnits)} size="sm" />
						{/if}
						{#if units(c.accruedUnits) > 0n && c.state !== 'settled'}
							<div class="sub">accrued {formatMoney(units(c.accruedUnits))}</div>
						{/if}
					{:else}
						<span class="strong">{formatMoney(units(c.dailyRateUnits))}</span>{' '}<span class="sub"
							>per day cap</span
						>
						{#if units(c.pulledUnits) > 0n}
							<div class="sub">pulled {formatMoney(units(c.pulledUnits))}</div>
						{/if}
					{/if}
				{/if}
			{/snippet}
		</Table>
	</div>
{/if}

<style>
	.toolbar {
		margin-bottom: var(--space-4);
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.search {
		flex: 1 1 16rem;
		max-width: 22rem;
	}
	.mode {
		width: 11rem;
	}
	@media (max-width: 767px) {
		.search {
			max-width: none;
		}
		.mode {
			flex: 1 1 auto;
		}
	}
	.table {
		margin-top: var(--space-4);
	}
	.stack {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
	}
	.sub {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}
	.strong {
		font-weight: var(--weight-medium);
	}
</style>
