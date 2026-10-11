<script lang="ts">
	/**
	 * Held transfers (details 11.8, DESIGN 11.9): payments the receive policy did not accept into
	 * a container's deposit, such as the wrong token or an unknown sender. The protocol guard holds
	 * them; the settlement contract returns them to the sender. Held, not lost.
	 */
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import {
		Badge,
		Button,
		Card,
		ContainerNumber,
		EmptyState,
		Hash,
		Money,
		PageHeader,
		Table,
		Tabs,
		TempoTag,
		formatDateTime,
		toast,
		type TableColumn
	} from '#lib/ui';
	import { useAuthedAction, useAuthedQuery } from '#lib/backend';
	import { useNarrow } from '#lib/app/line/useNarrow.svelte.ts';
	import {
		ChainResult,
		api,
		containerHref,
		errorMessage,
		units,
		useApp,
		useDemoActions,
		useDemoPageActions
	} from '#lib/app';

	const narrow = useNarrow();
	const app = useApp();
	const demo = useDemoActions();
	const held = useAuthedQuery(api.heldTransfers.list, { status: 'held' });
	const returned = useAuthedQuery(api.heldTransfers.list, { status: 'returned' });
	const returnToSender = useAuthedAction(api.heldTransfers.returnToSender);

	type Row = NonNullable<typeof held.data>[number];
	type Tab = 'held' | 'returned';
	let tab = $state<Tab>('held');
	let busyId = $state<string | null>(null);
	let error = $state('');
	let last = $state<{ row: Row; txHash: string; finalityMs: number } | null>(null);

	const heldRows = $derived(held.data ?? []);
	const returnedRows = $derived(returned.data ?? []);
	const tabs = $derived([
		{ value: 'held' as const, label: 'Held', count: heldRows.length },
		{ value: 'returned' as const, label: 'Returned', count: returnedRows.length }
	]);

	const REASON: Record<string, { label: string; tone: 'warning' | 'caution' | 'info' }> = {
		wrong_token: { label: 'Wrong token', tone: 'warning' },
		unknown_sender: { label: 'Unknown sender', tone: 'warning' },
		excess: { label: 'Overpayment', tone: 'info' }
	};

	async function giveBack(row: Row) {
		if (busyId) return;
		busyId = row._id;
		error = '';
		last = null;
		try {
			const r = await returnToSender({ heldTransferId: row._id });
			last = { row, txHash: r.txHash, finalityMs: r.finalityMs };
		} catch (e) {
			error = errorMessage(e);
			toast.error('Could not return the transfer', { description: error });
		} finally {
			busyId = null;
		}
	}

	useDemoPageActions(() => [
		{
			id: 'stranger-beta',
			label: 'Simulate a stranger transfer (BetaUSD)',
			hint: 'Wrong token to a deposit address',
			busy: demo.busy === 'stranger',
			disabled: !app.isSim,
			onclick: () => demo.sendStranger('BetaUSD')
		},
		{
			id: 'stranger-unknown',
			label: 'Simulate a stranger transfer (unknown sender)',
			hint: 'Right token from an unknown payer',
			busy: demo.busy === 'stranger',
			disabled: !app.isSim,
			onclick: () => demo.sendStranger('AlphaUSD')
		}
	]);

	const heldCols: TableColumn[] = [
		{ key: 'received', label: 'Received', hideBelow: 'sm' },
		{ key: 'from', label: 'From' },
		{ key: 'to', label: 'To deposit address', hideBelow: 'lg' },
		{ key: 'amount', label: 'Amount', numeric: true },
		{ key: 'memo', label: 'Memo', hideBelow: 'lg' },
		{ key: 'reason', label: 'Reason', hideBelow: 'md' },
		{ key: 'action', label: 'Action', srOnlyLabel: true, align: 'right', hideBelow: 'md' }
	];
	const returnedCols: TableColumn[] = [
		{ key: 'returned', label: 'Returned', hideBelow: 'sm' },
		{ key: 'to', label: 'Returned to' },
		{ key: 'amount', label: 'Amount', numeric: true },
		{ key: 'reason', label: 'Reason', hideBelow: 'md' },
		{ key: 'tx', label: 'Transaction' }
	];
</script>

<svelte:head><title>Held transfers · Portunus</title></svelte:head>

<PageHeader
	title="Held transfers"
	subtitle="Payments the guard did not accept: wrong token or unknown sender. Nothing is lost."
/>

<div class="page">
	<TempoTag
		feature="held_not_lost"
		variant="callout"
		detail="The receive policy holds these payments in the protocol guard. Only the settlement contract can move them, and it can send them back to exactly one place: the original sender."
	/>

	{#if last}
		<Card variant="outline">
			<div class="result" data-testid="return-result">
				<div class="result-head">
					<CircleCheck size={18} strokeWidth={1.75} aria-hidden="true" />
					<strong>
						Returned <Money amount={units(last.row.amountUnits)} unit={last.row.tokenSymbol} /> to sender
					</strong>
				</div>
				<ChainResult
					txHash={last.txHash}
					finalityMs={last.finalityMs}
					toastTitle="Held, not lost: returned to sender"
					toastDescription="The settlement contract sent it back from the guard."
				/>
			</div>
		</Card>
	{/if}

	{#if held.error || returned.error}
		<Card>
			<EmptyState
				tone="error"
				title="Held transfers did not load"
				description={errorMessage(held.error ?? returned.error)}
			/>
		</Card>
	{:else}
		<Tabs items={tabs} bind:value={tab} label="Held transfers" />

		{#if tab === 'held'}
			{#snippet reasonBadge(r: Row)}
				{@const reason = REASON[r.reason] ?? { label: r.reason, tone: 'warning' as const }}
				<Badge tone={reason.tone} dot>{reason.label}</Badge>
			{/snippet}

			{#snippet returnButton(r: Row)}
				<Button
					variant="secondary"
					size="sm"
					icon={Undo2}
					loading={busyId === r._id}
					loadingLabel="Returning"
					disabled={busyId !== null && busyId !== r._id}
					onclick={() => giveBack(r)}
					data-testid="return-to-sender"
				>
					Return to sender
				</Button>
			{/snippet}

			<Table
				caption="Held transfers waiting for return"
				columns={heldCols}
				rows={heldRows}
				rowKey={(r) => r._id}
				loading={held.isLoading}
				emptyIcon={ShieldCheck}
				emptyTitle="No held transfers"
				emptyDescription="Wrong-token and unknown-sender payments wait here until you return them."
			>
				{#snippet cell(r, c)}
					{#if c.key === 'received'}
						<span class="tabular muted">{formatDateTime(r.blockedAt)}</span>
					{:else if c.key === 'from'}
						<div class="stack">
							<Hash value={r.originator} kind="address" />
							{#if narrow.value}
								<div class="m-only">
									{@render reasonBadge(r)}
									{@render returnButton(r)}
								</div>
							{/if}
						</div>
					{:else if c.key === 'to'}
						<div class="stack">
							<Hash value={r.recipient} kind="address" />
							{#if r.containerNumber}
								<ContainerNumber
									value={r.containerNumber}
									size="sm"
									href={containerHref(r.containerNumber)}
								/>
							{/if}
						</div>
					{:else if c.key === 'amount'}
						<Money amount={units(r.amountUnits)} unit={r.tokenSymbol} />
					{:else if c.key === 'memo'}
						{#if r.memo}<span class="mono small memo" title={r.memo}>{r.memo}</span>{:else}<span
								class="muted">None</span
							>{/if}
					{:else if c.key === 'reason'}
						{@render reasonBadge(r)}
					{:else if c.key === 'action' && !narrow.value}
						{@render returnButton(r)}
					{/if}
				{/snippet}
			</Table>
		{:else}
			<Table
				caption="Transfers returned to their senders"
				columns={returnedCols}
				rows={returnedRows}
				rowKey={(r) => r._id}
				loading={returned.isLoading}
				emptyIcon={Undo2}
				emptyTitle="Nothing returned yet"
				emptyDescription="Transfers you send back to their senders are listed here with the transaction."
			>
				{#snippet cell(r, c)}
					{#if c.key === 'returned'}
						<span class="tabular muted">{r.returnedAt ? formatDateTime(r.returnedAt) : ''}</span>
					{:else if c.key === 'to'}
						<Hash value={r.originator} kind="address" />
					{:else if c.key === 'amount'}
						<Money amount={units(r.amountUnits)} unit={r.tokenSymbol} />
					{:else if c.key === 'reason'}
						{@const reason = REASON[r.reason] ?? { label: r.reason, tone: 'warning' as const }}
						<Badge tone="neutral">{reason.label}</Badge>
					{:else if c.key === 'tx'}
						{#if r.returnedTxHash}
							<Hash
								value={app.displayHash(r.returnedTxHash)}
								kind="tx"
								href={app.txUrl(r.returnedTxHash) ?? undefined}
								head={10}
							/>
						{/if}
					{/if}
				{/snippet}
			</Table>
		{/if}
	{/if}
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.result {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.result-head {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
		color: var(--tone-success-fg);
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		align-items: flex-start;
	}

	.m-only {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}

	.small {
		font-size: var(--text-xs);
	}

	.muted {
		color: var(--color-text-secondary);
	}

	.memo {
		display: inline-block;
		max-width: 16rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		vertical-align: bottom;
	}
</style>
