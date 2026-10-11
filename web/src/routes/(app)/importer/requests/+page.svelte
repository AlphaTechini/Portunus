<script lang="ts">
	/** Release requests sent to this importer, newest first. Rows open the pay / authorize page. */
	import Inbox from '@lucide/svelte/icons/inbox';
	import Search from '@lucide/svelte/icons/search';
	import {
		Badge,
		Button,
		Card,
		EmptyState,
		Input,
		Money,
		PageHeader,
		SegmentedControl,
		Table,
		formatDate,
		type TableColumn
	} from '#lib/ui';
	import { ModeBadge, api, errorMessage, importerRequestHref, units } from '#lib/app';
	import { useAuthedQuery } from '#lib/backend';

	const q = useAuthedQuery(api.releaseRequests.listForImporter, {});

	type Row = NonNullable<typeof q.data>[number];
	type Filter = 'all' | 'action' | 'active' | 'completed';
	let filter = $state<Filter>('all');
	let search = $state('');

	const needsAction = (r: Row) =>
		(r.byState.requested ?? 0) + (r.byState.awaiting_deposit ?? 0) > 0;
	const rows = $derived(
		(q.data ?? []).filter((r) => {
			if (filter === 'action' && !needsAction(r)) return false;
			if (
				filter === 'active' &&
				(needsAction(r) || r.status === 'completed' || r.status === 'cancelled')
			)
				return false;
			if (filter === 'completed' && r.status !== 'completed') return false;
			const s = search.trim().toUpperCase().replace(/\s+/g, '');
			return (
				!s ||
				r.billOfLading.toUpperCase().includes(s) ||
				r.requestCode.includes(s) ||
				r.containerNumbers.some((n) => n.includes(s))
			);
		})
	);

	const columns: TableColumn[] = [
		{ key: 'bl', label: 'Bill of lading' },
		{ key: 'line', label: 'Line', hideBelow: 'md' },
		{ key: 'mode', label: 'Mode', hideBelow: 'sm' },
		{ key: 'count', label: 'Containers', numeric: true, hideBelow: 'sm' },
		{ key: 'deposit', label: 'Deposit', numeric: true },
		{ key: 'status', label: 'Status' },
		{ key: 'created', label: 'Sent', hideBelow: 'lg' }
	];

	function statusOf(r: Row): {
		tone: 'warning' | 'protocol' | 'success' | 'neutral';
		label: string;
	} {
		if (r.status === 'cancelled') return { tone: 'neutral', label: 'Cancelled' };
		if (r.status === 'completed') return { tone: 'success', label: 'Completed' };
		if (needsAction(r))
			return {
				tone: 'warning',
				label: r.mode === 'depositFree' ? 'Awaiting authorization' : 'Awaiting deposit'
			};
		return { tone: 'protocol', label: 'In progress' };
	}
</script>

<svelte:head><title>Release requests · Portunus</title></svelte:head>

<PageHeader
	title="Release requests"
	subtitle="Requests from shipping lines. Pay deposits or authorize deposit-free release here."
/>

<div class="toolbar">
	<SegmentedControl
		label="Filter requests"
		size="sm"
		bind:value={filter}
		options={[
			{ value: 'all', label: 'All' },
			{ value: 'action', label: 'Needs action' },
			{ value: 'active', label: 'In progress' },
			{ value: 'completed', label: 'Completed' }
		]}
	/>
	<div class="search">
		<Input
			bind:value={search}
			icon={Search}
			placeholder="Search B/L or container"
			aria-label="Search by bill of lading or container number"
		/>
	</div>
</div>

{#if q.error}
	<Card padding="lg">
		<EmptyState
			tone="error"
			title="Could not load your requests"
			description={errorMessage(q.error)}
		>
			{#snippet actions()}
				<Button variant="secondary" onclick={() => location.reload()}>Try again</Button>
			{/snippet}
		</EmptyState>
	</Card>
{:else}
	<Table
		{columns}
		{rows}
		rowKey={(r) => r._id}
		caption="Release requests"
		rowHref={(r) => importerRequestHref(r._id)}
		rowLabel={(r) => `Release request ${r.billOfLading}`}
		loading={q.isLoading}
		emptyTitle={filter === 'all' && !search ? 'No release requests yet' : 'No requests match'}
		emptyDescription={filter === 'all' && !search
			? 'When a shipping line sends you a request, it appears here.'
			: 'Try another filter or search.'}
		emptyIcon={Inbox}
	>
		{#snippet cell(r, col)}
			{#if col.key === 'bl'}
				<div class="stack">
					<span class="mono strong">{r.billOfLading}</span>
					<span class="sub">{r.requestCode}</span>
				</div>
			{:else if col.key === 'line'}
				{r.lineName}
			{:else if col.key === 'mode'}
				<ModeBadge mode={r.mode} size="sm" />
			{:else if col.key === 'count'}
				{r.containerCount}
			{:else if col.key === 'deposit'}
				{#if r.mode === 'depositFree'}
					<span class="sub">No money moves</span>
				{:else}
					<Money amount={units(r.depositTotalUnits)} size="sm" />
					{#if units(r.receivedTotalUnits) > 0n}
						<div class="sub">
							received <Money amount={units(r.receivedTotalUnits)} size="xs" tone="muted" />
						</div>
					{/if}
				{/if}
			{:else if col.key === 'status'}
				{@const s = statusOf(r)}
				<Badge tone={s.tone} dot>{s.label}</Badge>
			{:else if col.key === 'created'}
				{formatDate(r.createdAt)}
			{/if}
		{/snippet}
	</Table>
{/if}

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}
	.search {
		width: min(100%, 18rem);
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-0-5);
	}
	.strong {
		font-weight: var(--weight-medium);
		color: var(--color-text);
	}
	.sub {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}
</style>
