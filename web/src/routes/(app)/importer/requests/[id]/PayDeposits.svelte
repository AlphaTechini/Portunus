<script lang="ts">
	/**
	 * Held mode: terms up front, deposit addresses and memos, balance check and ONE action,
	 * "Pay N deposits": passkey approval, one batch transaction, fee sponsored.
	 */
	import type { FunctionReturnType } from 'convex/server';
	import Wallet from '@lucide/svelte/icons/wallet';
	import Boxes from '@lucide/svelte/icons/boxes';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import {
		Button,
		Card,
		ContainerNumber,
		Hash,
		Money,
		Skeleton,
		StatusPill,
		Table,
		TempoTag,
		formatDays,
		formatMoney,
		type TableColumn
	} from '#lib/ui';
	import {
		ChainResult,
		Notice,
		api,
		containerHref,
		errorCode,
		errorMessage,
		isApprovalCancelled,
		units,
		useApp
	} from '#lib/app';
	import { useAuthedAction, useAuthedQuery } from '#lib/backend';

	type Request = NonNullable<FunctionReturnType<typeof api.releaseRequests.get>>;
	let { data }: { data: Request } = $props();

	const app = useApp();
	const requestId = $derived(data.request._id);
	const pay = useAuthedAction(api.deposits.payBatch);

	const awaiting = $derived(data.containers.filter((c) => c.state === 'awaiting_deposit'));
	let result = $state<FunctionReturnType<typeof api.deposits.payBatch> | null>(null);
	let paying = $state(false);
	let error = $state<{ code?: string; message: string } | null>(null);

	// The preview only exists while something is left to pay.
	const preview = useAuthedQuery(api.deposits.preview, () =>
		awaiting.length > 0 ? { requestId } : 'skip'
	);
	const p = $derived(preview.data);
	const n = $derived(p?.items.length ?? 0);
	const total = $derived(p ? units(p.totalUnits) : 0n);
	const balance = $derived(p?.balanceUnits != null ? units(p.balanceUnits) : null);
	const short = $derived(p?.sufficientBalance === false && balance !== null ? total - balance : 0n);
	const symbol = $derived(app.status?.settlementTokenSymbol ?? 'AlphaUSD');
	const anyPartial = $derived(
		data.containers.some((c) => units(c.receivedUnits) > 0n && !c.covered)
	);
	const terms = $derived(data.terms);

	const columns: TableColumn[] = [
		{ key: 'number', label: 'Container' },
		{ key: 'deposit', label: 'Deposit', numeric: true },
		{ key: 'free', label: 'Free time', numeric: true, hideBelow: 'sm' },
		{ key: 'rate', label: 'Detention per day', numeric: true, hideBelow: 'sm' },
		{ key: 'status', label: 'Status', hideBelow: 'sm' }
	];

	async function payAll() {
		if (!p || paying) return;
		error = null;
		try {
			const count = p.items.length;
			const { approval } = await app.approve({
				payloadHash: p.payloadHash,
				title: `Pay ${count} ${count === 1 ? 'deposit' : 'deposits'}`,
				description: `One transaction. The deposits go to ${data.line.name}'s protocol guard, not to the line's balance.`,
				amount: p.totalUnits,
				amountLabel: 'Total to pay',
				details: [
					{ label: 'Bill of lading', value: data.request.billOfLading },
					{ label: 'Containers', value: p.items.map((i) => i.number).join(', ') },
					{ label: 'Paid from', value: `${app.org.name}` }
				],
				confirmLabel: `Pay ${count} ${count === 1 ? 'deposit' : 'deposits'}`,
				confirmSublabel: 'One transaction. Fees sponsored.'
			});
			paying = true;
			result = await pay({ requestId, approval });
		} catch (e) {
			if (!isApprovalCancelled(e)) error = { code: errorCode(e), message: errorMessage(e) };
		} finally {
			paying = false;
		}
	}
</script>

<div class="grid">
	<div class="left">
		<Card title="Terms" description="Shown before you pay. These do not change after payment.">
			<Table
				framed={false}
				{columns}
				rows={data.containers}
				rowKey={(c) => c._id}
				caption="Terms per container"
			>
				{#snippet cell(c, col)}
					{#if col.key === 'number'}
						<div class="numcell">
							<ContainerNumber value={c.number} type={c.type} size="sm" />
							<span class="sm-only"><StatusPill state={c.state} /></span>
						</div>
					{:else if col.key === 'deposit'}
						<Money amount={units(c.depositUnits)} size="md" />
					{:else if col.key === 'free'}
						{formatDays(c.freeDays)}
					{:else if col.key === 'rate'}
						<Money amount={units(c.dailyRateUnits)} size="sm" />
					{:else if col.key === 'status'}
						{#if c.state === 'awaiting_deposit' && units(c.receivedUnits) > 0n}
							<div class="stack">
								<StatusPill state="awaiting_deposit" />
								<span class="hint">Missing {formatMoney(units(c.missingUnits))}</span>
							</div>
						{:else}
							<StatusPill
								state={result && c.state === 'deposit_held' ? 'deposit_held' : c.state}
								long={c.state !== 'awaiting_deposit'}
							/>
						{/if}
					{/if}
				{/snippet}
			</Table>

			<div class="rules">
				<h3 class="rules-title">How your refund works</h3>
				<ul>
					<li>
						<strong>Detention</strong> accrues per started day once free time ends, up to the deposit.
						Nothing is charged while the container is in free time.
					</li>
					<li>
						When the empty is back, the line records the depot's return receipt and has
						<strong>{formatDays(terms.settlementWindowDays)}</strong> to post final charges. Charges cannot
						exceed the deposit, or the accrued detention plus a stated damage amount.
					</li>
					<li>
						At the end of that window the <strong>remainder refunds to you automatically</strong>.
						Anyone can trigger it, so it never depends on the line.
					</li>
					<li>
						If the line never records the return, you can submit the return receipt yourself. The
						line then has the same window to contest it.
					</li>
					<li>
						You can <strong>dispute posted charges once</strong>, inside the window. Only the
						disputed amount stays held; the rest settles immediately.
					</li>
				</ul>
			</div>
		</Card>

		{#if p}
			<Card
				title="Where each deposit goes"
				description="One address and one memo per container, so the line sees every payment already matched."
			>
				<p class="tagline"><TempoTag feature="virtual_address" size="sm" /></p>
				<ul class="addr">
					{#each p.items as i (i.containerId)}
						<li>
							<div class="addr-top">
								<ContainerNumber value={i.number} type={i.type} size="sm" />
								<Money amount={units(i.amountUnits)} size="sm" />
							</div>
							<Hash
								value={i.to}
								kind="address"
								label="Deposit address"
								head={8}
								tail={6}
								size="sm"
							/>
							<div class="memo-row">
								<span class="memo-k">Memo</span>
								<code class="memo">{i.memo}</code>
							</div>
						</li>
					{/each}
				</ul>
			</Card>
		{/if}
	</div>

	<aside class="right">
		{#if result}
			<div data-testid="pay-success">
				<Card padding="md">
					<div class="s-head">
						<span class="s-icon" aria-hidden="true"
							><ShieldCheck size={18} strokeWidth={1.9} /></span
						>
						<div>
							<h2 class="s-title">
								{result.allCovered
									? 'Deposit held by protocol'
									: 'Payment received, not fully covered'}
							</h2>
							<p class="s-sub">
								{formatMoney(units(result.totalUnits))} paid in one batch transaction.
							</p>
						</div>
					</div>
					<ChainResult
						txHash={result.txHash}
						finalityMs={result.finalityMs}
						toastTitle={result.allCovered ? 'Deposit held by protocol' : 'Payment received'}
						toastDescription={`${formatMoney(units(result.totalUnits))} for ${result.containers.length} ${result.containers.length === 1 ? 'container' : 'containers'}`}
					/>
					<ul class="s-list">
						{#each result.containers as c (c.containerId)}
							<li>
								<ContainerNumber value={c.number} size="sm" href={containerHref(c.number)} />
								<StatusPill
									state={c.state === 'deposit_held' ? 'deposit_held' : 'awaiting_deposit'}
									long
								/>
							</li>
						{/each}
					</ul>
					{#if !result.allCovered}
						<Notice tone="warning" title="Release stays blocked">
							Each container must be fully covered before the line can issue the release order.
						</Notice>
					{:else}
						<div class="after">
							<TempoTag
								feature="receive_policy"
								variant="callout"
								detail="The line is guaranteed, but cannot spend or sit on your deposit. Only the settlement contract can release it."
							/>
							<div>
								<Button variant="secondary" href="/containers" icon={Boxes}>View containers</Button>
							</div>
						</div>
					{/if}
				</Card>
			</div>
		{/if}

		{#if awaiting.length > 0 || preview.isLoading}
			<div class="sticky">
				<Card title="Pay deposits" description="Approve once. All containers in one transaction.">
					{#if preview.isLoading && !p}
						<Skeleton lines={4} />
					{:else if preview.error}
						<Notice tone="danger" title="Could not prepare the payment">
							{errorMessage(preview.error)}
						</Notice>
					{:else if p}
						<div class="total">
							<span class="total-k">Total to pay</span>
							<Money amount={total} size="xl" dimCents />
							<span class="total-u">Paid in {symbol}, the agreed settlement currency</span>
						</div>

						{#if balance !== null}
							<dl class="bal">
								<div>
									<dt>Your balance</dt>
									<dd><Money amount={balance} size="sm" /></dd>
								</div>
								<div>
									<dt>After payment</dt>
									<dd>
										<Money
											amount={balance - total}
											size="sm"
											tone={short > 0n ? 'negative' : 'default'}
										/>
									</dd>
								</div>
							</dl>
						{/if}

						{#if anyPartial}
							<Notice tone="warning" title="Part of this request is already paid">
								You are paying only what is missing. Release stays blocked until each container is
								fully covered.
							</Notice>
						{/if}

						{#if short > 0n}
							<Notice tone="danger" title="Balance too low" data-testid="insufficient">
								You are {formatMoney(short)} short. Add funds to your account, then pay all
								{n}
								{n === 1 ? 'deposit' : 'deposits'} in one go.
							</Notice>
						{/if}

						{#if error}
							<Notice
								tone="danger"
								title={error.code === 'INSUFFICIENT_BALANCE'
									? 'Balance too low'
									: 'Payment did not go through'}
								data-testid="pay-error"
							>
								{error.message}
							</Notice>
						{/if}

						<div class="tags">
							<TempoTag feature="batch" size="sm" />
							<TempoTag feature="fee_sponsored" size="sm" />
							<TempoTag feature="memo" size="sm" />
						</div>

						<Button
							variant="accent"
							size="lg"
							fullWidth
							icon={Wallet}
							loading={paying}
							loadingLabel="Waiting for the chain"
							disabled={short > 0n || n === 0}
							onclick={payAll}
							data-testid="pay-deposits"
						>
							Pay {n}
							{n === 1 ? 'deposit' : 'deposits'}
						</Button>
						<p class="foot">
							<TempoTag feature="passkey" size="sm" /> One transaction. Fees sponsored.
						</p>
					{/if}
				</Card>
			</div>
		{:else if !result}
			<Card title="Deposits" description="Nothing left to pay on this request.">
				<Notice tone="protocol" title="Already paid" data-testid="already-paid">
					Every deposit on this request is held by the protocol guard. The line can issue the
					release order.
				</Notice>
				<div class="after">
					<TempoTag
						feature="receive_policy"
						variant="callout"
						detail="The line is guaranteed, but cannot spend or sit on your deposit."
					/>
					<div>
						<Button variant="secondary" href="/containers" icon={Boxes}>View containers</Button>
					</div>
				</div>
			</Card>
		{/if}
	</aside>
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 24rem;
		gap: var(--space-4);
		align-items: start;
	}
	.left,
	.right {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}
	.sticky {
		position: sticky;
		top: calc(var(--topbar-height) + var(--space-4));
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.numcell {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
	}
	.sm-only {
		display: none;
	}
	.tagline {
		margin: 0 0 var(--space-3);
	}
	@media (max-width: 640px) {
		.sm-only {
			display: inline-flex;
		}
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		align-items: flex-start;
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--tone-warning-fg);
	}

	.rules {
		margin-top: var(--space-5);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border-subtle);
	}
	.rules-title {
		margin: 0 0 var(--space-2);
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
	}
	.rules ul {
		list-style: disc;
		margin: 0;
		padding-left: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		color: var(--color-text-secondary);
		line-height: var(--leading-sm);
	}
	.rules strong {
		color: var(--color-text);
		font-weight: var(--weight-medium);
	}

	.addr {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.addr li {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) 0;
		border-top: 1px solid var(--color-border-subtle);
	}
	.addr li:first-child {
		border-top: 0;
		padding-top: 0;
	}
	.addr-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.memo-row {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.memo-k {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}
	.memo {
		padding: var(--space-0-5) var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--color-surface-sunken);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--color-text);
		word-break: break-all;
	}

	.total {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-4);
	}
	.total-k {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
		text-transform: uppercase;
		letter-spacing: var(--tracking-caps);
	}
	.total-u {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}
	.bal {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
		margin: 0 0 var(--space-4);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--color-surface-sunken);
	}
	.bal dt {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}
	.bal dd {
		margin: var(--space-0-5) 0 0;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: var(--space-4) 0;
	}
	.foot {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: var(--space-3) 0 0;
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}
	:global(.right .notice) {
		margin-bottom: var(--space-4);
	}

	.s-head {
		display: flex;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
	}
	.s-icon {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: var(--radius-md);
		background: var(--tone-protocol-bg);
		color: var(--tone-protocol-fg);
		flex-shrink: 0;
	}
	.s-title {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
	}
	.s-sub {
		margin: var(--space-0-5) 0 0;
		color: var(--color-text-secondary);
	}
	.after {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.after {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.s-list {
		list-style: none;
		margin: var(--space-4) 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.s-list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	@media (max-width: 1100px) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.right {
			order: -1;
		}
		.sticky {
			position: static;
		}
	}
</style>
