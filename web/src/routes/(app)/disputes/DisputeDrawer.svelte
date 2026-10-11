<script lang="ts">
	/** One dispute: breakdown, reason, timeline and, for the resolver, the split decision. */
	import {
		Badge,
		Button,
		ContainerNumber,
		Drawer,
		Field,
		Input,
		Money,
		Skeleton,
		Textarea,
		Timeline,
		formatDateTime,
		formatMoney,
		type TimelineEntry
	} from '#lib/ui';
	import {
		ChainResult,
		Notice,
		api,
		containerHref,
		errorMessage,
		fromUnits,
		toUnits,
		units,
		useApp
	} from '#lib/app';
	import { useAuthedAction, useAuthedQuery } from '#lib/backend';

	interface Props {
		open: boolean;
		disputeId: string | null;
	}
	let { open = $bindable(), disputeId }: Props = $props();

	const app = useApp();
	const list = useAuthedQuery(api.disputes.list, {});
	const detail = useAuthedQuery(api.disputes.get, () =>
		open && disputeId ? { disputeId: disputeId as never } : 'skip'
	);
	const resolve = useAuthedAction(api.disputes.resolve);

	const row = $derived((list.data ?? []).find((r) => r._id === disputeId));
	const d = $derived(detail.data);
	const dispute = $derived(d?.dispute);
	const disputed = $derived(dispute ? units(dispute.disputedUnits) : 0n);
	const canResolve = $derived(!!row?.canResolve);
	const charge = $derived(d ? units(d.container.chargesUnits) : 0n);

	let toLine = $state('0.00');
	let note = $state('');
	let busy = $state(false);
	let error = $state('');
	let touched = $state(false);
	let outcome = $state<Awaited<ReturnType<typeof resolve>> | null>(null);

	$effect(() => {
		// Start every dispute from "importer's favour"; the resolver moves the slider.
		void disputeId;
		toLine = '0.00';
		note = '';
		error = '';
		touched = false;
		outcome = null;
	});

	const toLineUnits = $derived.by(() => {
		try {
			return toUnits(String(toLine));
		} catch {
			return null;
		}
	});
	const lineErr = $derived(
		toLineUnits === null || toLineUnits < 0n
			? 'Enter an amount between $0.00 and the disputed amount.'
			: toLineUnits > disputed
				? `At most ${formatMoney(disputed)}, the disputed amount.`
				: ''
	);
	const toImporter = $derived(toLineUnits !== null && !lineErr ? disputed - toLineUnits : null);
	const noteErr = $derived(note.trim() ? '' : 'Add a short note explaining the decision.');
	const sliderMax = $derived(Number(disputed) / 1e6);

	function setLine(units_: bigint) {
		toLine = fromUnits(units_);
	}

	const trail = $derived<TimelineEntry[]>(
		(d?.payments ?? []).map((p, i) => ({
			id: `${p.kind}-${i}`,
			kind:
				p.kind === 'refund'
					? 'refund'
					: p.kind === 'deposit'
						? 'deposit'
						: p.kind === 'dispute_release'
							? 'dispute'
							: 'charge',
			title:
				p.kind === 'deposit'
					? 'Deposit held by protocol'
					: p.kind === 'charge'
						? 'Undisputed charge paid to the line'
						: p.kind === 'refund'
							? 'Refund to the importer'
							: 'Disputed funds released',
			timestamp: p.timestamp,
			amount: units(p.amountUnits),
			memo: p.memo || undefined,
			txHash: p.txHash ? app.displayHash(p.txHash) : undefined
		}))
	);

	async function decide() {
		touched = true;
		if (!dispute || lineErr || noteErr || toLineUnits === null) return;
		busy = true;
		error = '';
		try {
			outcome = await resolve({
				disputeId: dispute._id,
				toLineUnits: toLineUnits.toString(),
				note: note.trim()
			});
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<Drawer
	bind:open
	title="Dispute"
	description={row ? `${row.importerName} against ${row.lineName}` : undefined}
	size="lg"
>
	{#if detail.error}
		<Notice tone="danger" title="Could not load this dispute">{errorMessage(detail.error)}</Notice>
	{:else if !d || !dispute}
		<Skeleton lines={8} />
	{:else}
		<div class="col" data-testid="dispute-drawer">
			<div class="head">
				<ContainerNumber
					value={d.container.number}
					type={d.container.type}
					href={containerHref(d.container.number)}
				/>
				<Badge tone={dispute.status === 'open' ? 'danger' : 'success'} dot>
					{dispute.status === 'open' ? 'Open' : 'Resolved'}
				</Badge>
			</div>

			<dl class="figs">
				{#if dispute.status === 'resolved' && dispute.decision}
					<div>
						<dt>Disputed</dt>
						<dd><Money amount={disputed} size="lg" tone="negative" /></dd>
					</div>
					<div>
						<dt>Released to the line</dt>
						<dd><Money amount={units(dispute.decision.toLineUnits)} size="lg" /></dd>
					</div>
					<div>
						<dt>Refunded to the importer</dt>
						<dd>
							<Money amount={units(dispute.decision.toImporterUnits)} size="lg" tone="positive" />
						</dd>
					</div>
				{:else}
					<div>
						<dt>Charge posted</dt>
						<dd><Money amount={charge} size="lg" /></dd>
					</div>
					<div>
						<dt>Disputed, held by the contract</dt>
						<dd><Money amount={disputed} size="lg" tone="negative" /></dd>
					</div>
					<div>
						<dt>Settled already</dt>
						<dd>
							<Money amount={charge > disputed ? charge - disputed : 0n} size="lg" tone="muted" />
						</dd>
					</div>
				{/if}
			</dl>

			<section>
				<h3 class="h">Reason</h3>
				<p class="text">{dispute.reason}</p>
				{#if dispute.evidence}
					<h3 class="h">Evidence</h3>
					<p class="text">{dispute.evidence}</p>
				{/if}
				<p class="sub">
					Opened {formatDateTime(dispute.openedAt)} by {row?.openedByName ?? 'the importer'}
				</p>
			</section>

			{#if outcome}
				<Notice tone="success" title="Decision recorded" data-testid="dispute-resolved">
					{formatMoney(units(outcome.toLineUnits))} to the line, {formatMoney(
						units(outcome.toImporterUnits)
					)}
					refunded to the importer.
				</Notice>
				{#if outcome.txHashes[0]}
					<ChainResult
						txHash={outcome.txHashes[0]}
						toastTitle="Dispute resolved"
						toastDescription="The settlement contract released the held funds."
						tag
					/>
				{/if}
			{:else if dispute.status === 'resolved' && dispute.decision}
				<Notice tone="success" title="Resolved" data-testid="dispute-decision">
					{formatMoney(units(dispute.decision.toLineUnits))} to {row?.lineName ?? 'the line'},
					{formatMoney(units(dispute.decision.toImporterUnits))} to {row?.importerName ??
						'the importer'}.
					{dispute.decision.note}
				</Notice>
			{:else if canResolve}
				<section class="resolve" data-testid="resolve-panel">
					<h3 class="h">Your decision</h3>
					<p class="text">
						Split the {formatMoney(disputed)} held by the settlement contract. The contract can pay only
						the line or the importer.
					</p>
					<div class="presets">
						<Button variant="secondary" size="sm" onclick={() => setLine(0n)}
							>All to the importer</Button
						>
						<Button variant="secondary" size="sm" onclick={() => setLine(disputed / 2n)}
							>Split evenly</Button
						>
						<Button variant="secondary" size="sm" onclick={() => setLine(disputed)}
							>All to the line</Button
						>
					</div>
					<div class="slider">
						<input
							type="range"
							min="0"
							max={sliderMax}
							step="0.01"
							value={toLineUnits !== null ? Number(toLineUnits) / 1e6 : 0}
							oninput={(e) => (toLine = Number(e.currentTarget.value).toFixed(2))}
							aria-label="Amount to the line"
						/>
					</div>
					<div class="split">
						<Field label="To the line" error={touched ? lineErr : ''}>
							<Input
								bind:value={toLine}
								prefix="$"
								numeric
								inputmode="decimal"
								invalid={touched && !!lineErr}
								data-testid="to-line"
							/>
						</Field>
						<div class="to-imp">
							<span class="to-k">Refunded to the importer</span>
							<Money amount={toImporter ?? 0n} size="lg" tone="positive" />
						</div>
					</div>
					<Field label="Note to both sides" error={touched ? noteErr : ''}>
						<Textarea
							bind:value={note}
							rows={3}
							maxlength={400}
							showCount
							placeholder="Why this split?"
							invalid={touched && !!noteErr}
						/>
					</Field>
					{#if error}<Notice tone="danger" title="Could not resolve">{error}</Notice>{/if}
					<Button
						variant="accent"
						fullWidth
						loading={busy}
						onclick={decide}
						data-testid="resolve-dispute"
					>
						Resolve dispute
					</Button>
				</section>
			{:else if dispute.status === 'open'}
				<Notice tone="protocol" title="Waiting for the resolver">
					Disputed funds stay held by the settlement contract until {row
						? 'the resolver'
						: 'the resolver'} decides. Undisputed funds already settled.
				</Notice>
			{/if}

			{#if trail.length}
				<section>
					<h3 class="h">Money trail</h3>
					<Timeline entries={trail} order="oldest" label="Settlement payments" />
				</section>
			{/if}
		</div>
	{/if}
</Drawer>

<style>
	.col {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.figs {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-3);
		margin: 0;
		padding: var(--space-4);
		border-radius: var(--radius-lg);
		background: var(--color-surface-sunken);
	}
	.figs dt,
	.to-k {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
		margin-bottom: var(--space-1);
	}
	.figs dd {
		margin: 0;
	}
	.h {
		margin: 0 0 var(--space-1-5);
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
	}
	.text {
		margin: 0 0 var(--space-3);
		color: var(--color-text-secondary);
		line-height: var(--leading-sm);
	}
	.sub {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}
	.resolve {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}
	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.slider input {
		width: 100%;
		accent-color: var(--color-accent);
	}
	.split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-4);
		align-items: end;
	}
	.to-imp {
		display: flex;
		flex-direction: column;
		padding-bottom: var(--space-2);
	}
	@media (max-width: 560px) {
		.figs,
		.split {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
