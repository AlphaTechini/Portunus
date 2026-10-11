<script lang="ts">
	/**
	 * Disputes (DESIGN 11.10), for the line, the importer and the resolver. Disputed funds stay
	 * held by the settlement contract; the resolver splits them and the contract pays out.
	 */
	import Flag from '@lucide/svelte/icons/flag';
	import {
		Badge,
		Button,
		Card,
		ContainerNumber,
		EmptyState,
		Money,
		PageHeader,
		Table,
		Tabs,
		TempoTag,
		formatDate,
		type TableColumn
	} from '#lib/ui';
	import { api, errorMessage, units } from '#lib/app';
	import { useAuthedQuery } from '#lib/backend';
	import DisputeDrawer from './DisputeDrawer.svelte';

	const q = useAuthedQuery(api.disputes.list, {});
	type Row = NonNullable<typeof q.data>[number];

	let tab = $state<'open' | 'resolved'>('open');
	let selectedId = $state<string | null>(null);
	let drawerOpen = $state(false);

	const all = $derived(q.data ?? []);
	const open = $derived(all.filter((d) => d.status === 'open'));
	const resolved = $derived(all.filter((d) => d.status === 'resolved'));
	const rows = $derived(tab === 'open' ? open : resolved);

	const tabItems = $derived([
		{ value: 'open' as const, label: 'Open', count: open.length },
		{ value: 'resolved' as const, label: 'Resolved', count: resolved.length }
	]);

	const columns: TableColumn[] = [
		{ key: 'container', label: 'Container' },
		{ key: 'raised', label: 'Raised by', hideBelow: 'lg' },
		{ key: 'disputed', label: 'Disputed', numeric: true },
		{ key: 'undisputed', label: 'Settled already', numeric: true, hideBelow: 'lg' },
		{ key: 'reason', label: 'Reason', hideBelow: 'lg' },
		{ key: 'opened', label: 'Opened', hideBelow: 'sm', width: '7rem' },
		{ key: 'status', label: 'Status', hideBelow: 'sm' },
		{ key: 'act', label: 'Open', srOnlyLabel: true, align: 'right', width: '6rem' }
	];

	function openRow(r: Row) {
		selectedId = r._id;
		drawerOpen = true;
	}
	const undisputed = (r: Row) => {
		const v = units(r.chargesUnits) - units(r.disputedUnits);
		return v > 0n ? v : 0n;
	};
</script>

<svelte:head><title>Disputes · Portunus</title></svelte:head>

<PageHeader title="Disputes" subtitle="Charges an importer disputed, and how they are resolved." />

<div class="stack">
	<TempoTag
		feature="recovery_authority"
		variant="callout"
		label="Disputed funds stay held by the settlement contract"
		detail="Undisputed funds settle immediately. Only the agreed resolver can release the held amount, and only to the line or back to the importer."
	/>

	{#if q.error}
		<Card padding="lg">
			<EmptyState tone="error" title="Could not load disputes" description={errorMessage(q.error)}>
				{#snippet actions()}
					<Button variant="secondary" onclick={() => location.reload()}>Try again</Button>
				{/snippet}
			</EmptyState>
		</Card>
	{:else}
		<Tabs items={tabItems} bind:value={tab} label="Dispute status" />
		<Table
			{columns}
			{rows}
			rowKey={(r) => r._id}
			caption={tab === 'open' ? 'Open disputes' : 'Resolved disputes'}
			loading={q.isLoading}
			emptyTitle={tab === 'open' ? 'No open disputes' : 'No resolved disputes yet'}
			emptyDescription={tab === 'open'
				? 'Importers can dispute posted charges once, from the container page.'
				: 'Decisions appear here with the split.'}
			emptyIcon={Flag}
		>
			{#snippet cell(r, col)}
				{#if col.key === 'container'}
					<div class="cell">
						<ContainerNumber
							value={r.containerNumber}
							type={r.containerType ?? undefined}
							size="sm"
						/>
						<span class="sub mono">{r.billOfLading}</span>
					</div>
				{:else if col.key === 'raised'}
					<div class="cell">
						<span>{r.importerName}</span>
						<span class="sub">against {r.lineName}</span>
					</div>
				{:else if col.key === 'disputed'}
					<Money amount={units(r.disputedUnits)} size="sm" tone="negative" />
					{#if r.status === 'open'}<div class="sub">still held</div>{/if}
				{:else if col.key === 'undisputed'}
					{#if r.status === 'open'}<Money
							amount={undisputed(r)}
							size="sm"
							tone="muted"
						/>{:else}<span class="sub">–</span>{/if}
				{:else if col.key === 'reason'}
					<span class="reason" title={r.reason}>{r.reason}</span>
				{:else if col.key === 'opened'}
					<span class="nowrap">{formatDate(r.openedAt)}</span>
				{:else if col.key === 'status'}
					{#if r.status === 'open'}
						<Badge tone="danger" dot>{r.canResolve ? 'Needs your decision' : 'Open'}</Badge>
					{:else}
						<Badge tone="success" dot>Resolved</Badge>
					{/if}
				{:else if col.key === 'act'}
					<Button
						variant="secondary"
						size="sm"
						onclick={() => openRow(r)}
						data-testid="open-dispute"
					>
						{r.canResolve ? 'Resolve' : 'View'}
					</Button>
				{/if}
			{/snippet}
		</Table>
	{/if}
</div>

<DisputeDrawer bind:open={drawerOpen} disputeId={selectedId} />

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.cell {
		white-space: nowrap;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-0-5);
	}
	.sub {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}
	.nowrap {
		white-space: nowrap;
	}
	.reason {
		display: block;
		max-width: 10rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-secondary);
	}
</style>
