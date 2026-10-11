<script lang="ts">
	/** All release requests of the line, newest first, with a filter and a search. */
	import FilePlus from '@lucide/svelte/icons/file-plus';
	import Search from '@lucide/svelte/icons/search';
	import {
		Button,
		Card,
		EmptyState,
		Input,
		Money,
		PageHeader,
		SegmentedControl,
		StatusPill,
		Table,
		formatDate,
		type TableColumn
	} from '#lib/ui';
	import { useAuthedQuery } from '#lib/backend';
	import { api, errorMessage, lineRequestHref, units } from '#lib/app';
	import ModeBadge from '#lib/app/line/ModeBadge.svelte';
	import { headlineState, stateSummary } from '#lib/app/line/lineStatus.ts';

	const requests = useAuthedQuery(api.releaseRequests.listForLine, {});

	type Filter = 'all' | 'awaiting_importer' | 'active' | 'completed';
	let filter = $state<Filter>('all');
	let search = $state('');

	const rows = $derived.by(() => {
		const q = search.replace(/\s+/g, '').toUpperCase();
		return (requests.data ?? []).filter(
			(r) =>
				(filter === 'all' || r.status === filter) &&
				(!q ||
					r.billOfLading.toUpperCase().includes(q) ||
					r.importerName.replace(/\s+/g, '').toUpperCase().includes(q) ||
					r.requestCode.includes(q) ||
					r.containerNumbers.some((n) => n.includes(q)))
		);
	});

	const columns: TableColumn[] = [
		{ key: 'bl', label: 'Bill of lading' },
		{ key: 'importer', label: 'Importer' },
		{ key: 'mode', label: 'Mode', hideBelow: 'md' },
		{ key: 'containers', label: 'Containers', numeric: true, hideBelow: 'sm' },
		{ key: 'coverage', label: 'Deposit received', numeric: true, hideBelow: 'lg' },
		{ key: 'status', label: 'Status' },
		{ key: 'created', label: 'Created', hideBelow: 'lg' }
	];
</script>

<svelte:head><title>Release requests · Portunus</title></svelte:head>

<PageHeader
	title="Release requests"
	subtitle="Every bill of lading you have sent to an importer, and where it stands."
>
	{#snippet actions()}
		<Button href="/line/requests/new" variant="primary" icon={FilePlus}>New release request</Button>
	{/snippet}
</PageHeader>

{#if requests.error}
	<Card>
		<EmptyState
			tone="error"
			title="Requests could not load"
			description={errorMessage(requests.error)}
		/>
	</Card>
{:else}
	<div class="toolbar">
		<SegmentedControl
			label="Filter by status"
			bind:value={filter}
			options={[
				{ value: 'all', label: 'All' },
				{ value: 'awaiting_importer', label: 'Awaiting importer' },
				{ value: 'active', label: 'Active' },
				{ value: 'completed', label: 'Completed' }
			]}
		/>
		<div class="search">
			<Input
				bind:value={search}
				icon={Search}
				placeholder="Search B/L, importer or container"
				aria-label="Search release requests"
				type="search"
			/>
		</div>
	</div>
	<Table
		caption="Release requests"
		{columns}
		{rows}
		rowKey={(r) => r._id}
		loading={requests.isLoading}
		rowHref={(r) => lineRequestHref(r._id)}
		rowLabel={(r) => `Open request ${r.billOfLading}`}
		emptyTitle={search || filter !== 'all' ? 'No requests match' : 'No release requests yet'}
		emptyDescription={search || filter !== 'all'
			? 'Try a different filter or search.'
			: 'Create one to generate a deposit address per container.'}
		emptyIcon={FilePlus}
	>
		{#snippet cell(r, c)}
			{#if c.key === 'bl'}
				<span class="mono">{r.billOfLading}</span>
			{:else if c.key === 'importer'}
				{r.importerName}
			{:else if c.key === 'mode'}
				<ModeBadge mode={r.mode} size="sm" />
			{:else if c.key === 'containers'}
				<span title={stateSummary(r.byState)}>{r.containerCount}</span>
			{:else if c.key === 'coverage'}
				{#if r.mode === 'held'}
					<Money amount={units(r.receivedTotalUnits)} />
					<span class="of">of <Money amount={units(r.depositTotalUnits)} /></span>
				{:else}
					<span class="of">No cash moves</span>
				{/if}
			{:else if c.key === 'status'}
				<StatusPill state={headlineState(r.byState)} />
			{:else if c.key === 'created'}
				<span class="muted tabular">{formatDate(r.createdAt)}</span>
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
		flex: 0 1 22rem;
		min-width: min(100%, 14rem);
	}

	.muted,
	.of {
		color: var(--color-text-secondary);
	}

	.of {
		margin-left: var(--space-1);
		font-size: var(--text-xs);
	}
</style>
