<script lang="ts">
	/**
	 * One release request: pay the deposits (held mode, DESIGN 11.5) or authorize the access
	 * keys (deposit-free mode, DESIGN 11.6). The id in the URL is the request id or its short code.
	 */
	import { page } from '$app/state';
	import FileQuestion from '@lucide/svelte/icons/file-question';
	import { Button, Card, EmptyState, PageHeader, Skeleton } from '#lib/ui';
	import { ModeBadge, api, errorMessage } from '#lib/app';
	import { StatusPill } from '#lib/ui';
	import { useAuthedQuery } from '#lib/backend';
	import PayDeposits from './PayDeposits.svelte';
	import AuthorizeKeys from './AuthorizeKeys.svelte';

	const param = $derived(decodeURIComponent(page.params.id ?? ''));
	// Convex ids are long; request codes are short.
	const isCode = $derived(param.length > 0 && param.length <= 12);
	const q = useAuthedQuery(api.releaseRequests.get, () =>
		!param ? 'skip' : isCode ? { requestCode: param } : { requestId: param as never }
	);
	const d = $derived(q.data);

	const state = $derived.by(() => {
		const cs = d?.containers ?? [];
		if (cs.some((c) => c.state === 'awaiting_deposit')) return 'awaiting_deposit' as const;
		if (cs.some((c) => c.state === 'requested')) return 'requested' as const;
		return (cs[0]?.state ?? 'requested') as import('#lib/ui').ContainerState;
	});
</script>

<svelte:head
	><title>{d ? `Release request ${d.request.billOfLading}` : 'Release request'} · Portunus</title
	></svelte:head
>

{#if q.error}
	<PageHeader
		title="Release request"
		breadcrumbs={[
			{ label: 'Release requests', href: '/importer/requests' },
			{ label: 'Release request' }
		]}
	/>
	<Card padding="lg">
		<EmptyState
			tone="error"
			title="Could not open this request"
			description={errorMessage(q.error, 'This request could not be loaded.')}
		>
			{#snippet actions()}
				<Button variant="secondary" href="/importer/requests">Back to requests</Button>
			{/snippet}
		</EmptyState>
	</Card>
{:else if q.data === undefined}
	<PageHeader
		title="Release request"
		breadcrumbs={[{ label: 'Release requests', href: '/importer/requests' }, { label: 'Loading' }]}
	/>
	<div class="load">
		<Card><Skeleton lines={6} /></Card>
		<Card><Skeleton lines={5} /></Card>
	</div>
{:else if d === null}
	<PageHeader
		title="Release request"
		breadcrumbs={[
			{ label: 'Release requests', href: '/importer/requests' },
			{ label: 'Not found' }
		]}
	/>
	<Card padding="lg">
		<EmptyState
			icon={FileQuestion}
			title="Request not found"
			description="It may belong to another importer, or the link is wrong."
		>
			{#snippet actions()}
				<Button variant="secondary" href="/importer/requests">Back to requests</Button>
			{/snippet}
		</EmptyState>
	</Card>
{:else if d}
	<PageHeader
		title="Release request {d.request.billOfLading}"
		subtitle="From {d.line.name}, {d.request.portOfDischarge}{d.request.vessel
			? ` · ${d.request.vessel}${d.request.voyage ? ' ' + d.request.voyage : ''}`
			: ''}"
		breadcrumbs={[
			{ label: 'Release requests', href: '/importer/requests' },
			{ label: d.request.billOfLading }
		]}
	>
		{#snippet titleSnippet()}
			Release request <span class="mono bl">{d.request.billOfLading}</span>
		{/snippet}
		{#snippet meta()}
			<StatusPill {state} long size="lg" />
			<ModeBadge mode={d.request.mode} />
		{/snippet}
	</PageHeader>

	{#if d.request.mode === 'held'}
		<PayDeposits data={d} />
	{:else}
		<AuthorizeKeys data={d} />
	{/if}
{/if}

<style>
	.load {
		display: grid;
		gap: var(--space-4);
		max-width: 40rem;
	}
	.bl {
		font-weight: var(--weight-medium);
	}
</style>
