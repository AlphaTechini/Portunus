<script lang="ts">
	/**
	 * Settlement panel for one returned container (details 11.7 and section 9, DESIGN 11.8): the
	 * return receipt, the window countdown, the settle preview with the damage input, and the
	 * accent action "Post charges and settle". Also where a line contests a receipt the importer
	 * submitted under the silent-line rule.
	 */
	import { untrack } from 'svelte';
	import Flag from '@lucide/svelte/icons/flag';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import {
		Badge,
		Button,
		Drawer,
		Field,
		Input,
		Money,
		StatusPill,
		TempoTag,
		Textarea,
		formatContainerNumber,
		formatDateTime,
		formatDays,
		formatMoney,
		toast
	} from '#lib/ui';
	import { useAuthedAction, useAuthedMutation } from '#lib/backend';
	import {
		ChainResult,
		ProductCountdown,
		api,
		containerHref,
		errorMessage,
		units,
		useApp
	} from '#lib/app';
	import { accrued, detentionDaysAt, settlementAmounts } from '#lib/shared/domain/rules.ts';
	import ModeBadge from './ModeBadge.svelte';
	import SplitBar from './SplitBar.svelte';
	import { parseUsdToUnits, unitsToInput, type LineContainer } from './lineStatus.ts';

	interface Props {
		open: boolean;
		container: LineContainer | undefined;
		/** Open with the contest form showing (from the "Contest" row action). */
		contest?: boolean;
	}
	let { open = $bindable(false), container, contest = false }: Props = $props();

	const app = useApp();
	const post = useAuthedAction(api.containers.postCharges);
	const contestReceipt = useAuthedMutation(api.containers.contestReturnReceipt);

	type Outcome = Awaited<ReturnType<typeof post>>;
	let damage = $state('');
	let note = $state('');
	let busy = $state(false);
	let error = $state('');
	let outcome = $state<Outcome | null>(null);
	let contesting = $state(false);
	let contestNote = $state('');
	let contestBusy = $state(false);

	const c = $derived(container);

	// Reset when the drawer opens for a (different) container.
	let lastId: string | undefined;
	$effect(() => {
		if (open && c && c._id !== lastId) {
			lastId = c._id;
			untrack(() => {
				damage = c.damageUnits && c.damageUnits !== '0' ? unitsToInput(c.damageUnits) : '';
				note = c.chargeNote ?? '';
				error = '';
				outcome = null;
				contesting = contest;
				contestNote = '';
			});
		}
		if (!open) lastId = undefined;
	});
	$effect(() => {
		if (open && contest) contesting = true;
	});

	const returned = $derived(c?.state === 'returned');
	const heldMode = $derived(c?.mode === 'held');
	const byImporter = $derived(c?.returnReceipt?.submittedBy === 'importer');

	const damageUnits = $derived(parseUsdToUnits(damage));
	const calc = $derived.by(() => {
		if (!c || c.freeTimeEndsAt === undefined) return null;
		const days = detentionDaysAt(
			{
				freeTimeEndsAt: c.freeTimeEndsAt,
				maxDetentionDays: c.maxDetentionDays,
				returnedAt: c.returnedAt
			},
			app.now()
		);
		const acc = accrued({
			days,
			dailyRateUnits: c.dailyRateUnits,
			depositUnits: c.depositUnits
		});
		const dmg = damageUnits ?? 0n;
		const deposit = units(c.depositUnits);
		if (heldMode) {
			const held = units(c.receivedUnits);
			const a = settlementAmounts({
				heldUnits: held,
				depositUnits: c.depositUnits,
				accruedUnits: acc,
				damageUnits: dmg
			});
			return {
				days,
				accrued: acc,
				cap: a.chargeUnits,
				toLine: a.chargeUnits,
				refund: a.refundUnits,
				capped: acc + dmg > deposit,
				maxDamage: undefined as bigint | undefined
			};
		}
		// Deposit-free: detention was collected daily; damage is one extra pull limited by the key.
		const pulled = units(c.pulledUnits);
		const dailyCap = units(c.accessKey?.dailyLimitUnits);
		const room = deposit > pulled ? deposit - pulled : 0n;
		const maxDamage = dailyCap > 0n && dailyCap < room ? dailyCap : room;
		const dmgEff = dmg > maxDamage ? maxDamage : dmg;
		return {
			days,
			accrued: acc,
			cap: pulled + dmgEff,
			toLine: pulled + dmgEff,
			refund: 0n,
			capped: dmg > maxDamage,
			maxDamage
		};
	});

	const damageError = $derived.by(() => {
		if (damageUnits === null) return 'Enter an amount like 150.00.';
		if (calc?.maxDamage !== undefined && damageUnits > calc.maxDamage)
			return `On a deposit-free container damage cannot exceed ${formatMoney(calc.maxDamage)} (the key's daily cap or what is left of the deposit).`;
		return '';
	});

	const revokeRequested = $derived(
		!!c?.accessKey?.revokeRequestedAt && c.accessKey.status !== 'revoked'
	);

	async function settle() {
		if (!c || busy || damageError) return;
		busy = true;
		error = '';
		try {
			outcome = await post({
				containerId: c._id,
				damageUnits: (damageUnits ?? 0n).toString(),
				note: note.trim() || undefined
			});
		} catch (e) {
			error = errorMessage(e);
			toast.error('Could not settle', { description: error });
		} finally {
			busy = false;
		}
	}

	async function doContest() {
		if (!c || contestBusy) return;
		contestBusy = true;
		try {
			await contestReceipt({ containerId: c._id, note: contestNote.trim() || undefined });
			toast.success(`Receipt contested for ${c.number}`, {
				description: 'The container is back out. The importer is notified.'
			});
			open = false;
		} catch (e) {
			toast.error('Could not contest the receipt', { description: errorMessage(e) });
		} finally {
			contestBusy = false;
		}
	}
</script>

<Drawer
	bind:open
	size="lg"
	title={c ? `Settle ${formatContainerNumber(c.number)}` : 'Settle'}
	description={c ? `${c.importerName}, bill of lading ${c.billOfLading}` : undefined}
	dismissible={!busy}
>
	{#if c}
		<div class="body" data-testid="settle-drawer">
			<div class="meta">
				<StatusPill state={c.pendingOnChainFlag ? 'pending_onchain' : c.state} long />
				<ModeBadge mode={c.mode} />
				<a class="link" href={containerHref(c.number)}>Open container</a>
			</div>

			{#if c.returnReceipt}
				<section class="block" aria-label="Return receipt">
					<h3 class="over">Return receipt</h3>
					<dl class="facts">
						<div>
							<dt>EIR number</dt>
							<dd class="mono" data-testid="settle-eir">{c.returnReceipt.eirNumber}</dd>
						</div>
						<div>
							<dt>Depot</dt>
							<dd>{c.returnReceipt.depot}</dd>
						</div>
						<div>
							<dt>Returned</dt>
							<dd class="tabular">{formatDateTime(c.returnReceipt.date)}</dd>
						</div>
						<div>
							<dt>Recorded by</dt>
							<dd>
								{#if byImporter}
									<Badge tone="caution" dot>Submitted by the importer</Badge>
								{:else}
									<Badge tone="neutral">Shipping line</Badge>
								{/if}
							</dd>
						</div>
					</dl>
					{#if byImporter && returned}
						<div class="notice">
							<p>
								You did not record this return, so the importer submitted the receipt (silent line
								rule). Contest it inside the window, or the refund proceeds.
							</p>
							{#if contesting}
								<Field
									label="Why are you contesting it?"
									hint="Optional. The importer sees this note."
								>
									<Textarea bind:value={contestNote} rows={2} maxlength={300} showCount />
								</Field>
								<div class="actions">
									<Button variant="ghost" size="sm" onclick={() => (contesting = false)}>
										Cancel
									</Button>
									<Button
										variant="danger"
										size="sm"
										icon={Flag}
										loading={contestBusy}
										onclick={doContest}
										data-testid="confirm-contest"
									>
										Contest receipt
									</Button>
								</div>
							{:else}
								<Button
									variant="secondary"
									size="sm"
									icon={Flag}
									onclick={() => (contesting = true)}
									data-testid="contest"
								>
									Contest receipt
								</Button>
							{/if}
						</div>
					{/if}
				</section>
			{/if}

			{#if c.settlementWindowEndsAt && returned}
				<section class="block" aria-label="Settlement window">
					<ProductCountdown
						label="Settlement window ends in"
						start={c.returnedAt}
						target={c.settlementWindowEndsAt}
						showTarget
						size="md"
					/>
					<p class="hint">
						At the end of the window the remainder refunds automatically. Anyone can trigger it.
					</p>
				</section>
			{/if}

			{#if calc && (returned || outcome)}
				<section class="block" aria-label="Settlement preview">
					<div class="sec-head">
						<h3 class="over">{outcome ? 'Settled' : 'Settlement preview'}</h3>
						{#if !outcome}<TempoTag feature="recovery_authority" size="sm" />{/if}
					</div>
					<div class="line">
						<span>Detention</span>
						<span class="tabular">
							{formatDays(calc.days)}{#if calc.days > 0}
								at {formatMoney(units(c.dailyRateUnits))} per day{/if}
						</span>
					</div>
					<div class="line">
						<span>{heldMode ? 'Accrued detention' : 'Accrued detention (pulled daily)'}</span>
						<Money amount={calc.accrued} />
					</div>
					<div class="line">
						<span>{heldMode ? 'Deposit held' : 'Pulled so far'}</span>
						<Money amount={heldMode ? units(c.receivedUnits) : units(c.pulledUnits)} />
					</div>

					{#if !outcome}
						<Field
							label="Damage charge"
							hint={heldMode
								? `Cannot exceed the deposit (${formatMoney(units(c.depositUnits))}), or the accrued detention plus the stated damage.`
								: 'Optional. Collected with one extra pull on the access key.'}
							error={damageError || undefined}
						>
							<Input
								bind:value={damage}
								prefix="$"
								numeric
								placeholder="0.00"
								inputmode="decimal"
								autocomplete="off"
								data-testid="damage-input"
							/>
						</Field>
						{#if heldMode}
							<div class="line strong">
								<span>Maximum charge: lower of the deposit and accrued plus damage</span>
								<Money amount={calc.cap} />
							</div>
							{#if calc.capped}
								<p class="hint">The charge is capped by what the importer's deposit holds.</p>
							{/if}
						{/if}
					{/if}

					<div class="split">
						<div>
							<span class="who">To {c.lineName}</span>
							<span data-testid="to-line">
								<Money
									amount={outcome?.chargeUnits ? units(outcome.chargeUnits) : calc.toLine}
									size="xl"
								/>
							</span>
						</div>
						<div class="right">
							<span class="who">{heldMode ? `Refund to ${c.importerName}` : 'Refund'}</span>
							<span data-testid="refund-amount">
								<Money
									amount={outcome?.refundUnits ? units(outcome.refundUnits) : calc.refund}
									size="xl"
									tone={heldMode ? 'positive' : 'muted'}
								/>
							</span>
						</div>
					</div>
					{#if heldMode}
						<SplitBar
							toLine={Number(outcome?.chargeUnits ? units(outcome.chargeUnits) : calc.toLine)}
							toImporter={Number(outcome?.refundUnits ? units(outcome.refundUnits) : calc.refund)}
							lineLabel="To the line"
							importerLabel="Refund to the importer"
						/>
					{:else}
						<p class="hint">
							Deposit-free: the importer's money never left their account, so there is nothing to
							refund. The access key is revoked at settlement.
						</p>
					{/if}

					{#if !outcome}
						<Field label="Note to the importer" hint="Optional.">
							<Textarea bind:value={note} rows={2} maxlength={300} />
						</Field>
					{/if}
				</section>
			{/if}

			{#if outcome}
				<section class="block done" aria-label="Settlement result" data-testid="settle-result">
					<div class="done-head">
						<CircleCheck size={18} strokeWidth={1.75} aria-hidden="true" />
						<strong>
							Settled: {formatMoney(units(outcome.chargeUnits ?? '0'))} to {c.lineName}{#if heldMode},
								{formatMoney(units(outcome.refundUnits ?? '0'))} refunded{/if}
						</strong>
					</div>
					{#if outcome.txHash}
						<ChainResult
							txHash={outcome.txHash}
							toastTitle={heldMode ? 'Refund in seconds' : 'Settled'}
							toastDescription={`${formatMoney(units(outcome.chargeUnits ?? '0'))} to ${c.lineName}${heldMode ? `, ${formatMoney(units(outcome.refundUnits ?? '0'))} refunded to ${c.importerName}` : ''}.`}
						/>
					{/if}
					<div class="tags">
						<TempoTag feature="recovery_authority" size="sm" />
						{#if heldMode}<TempoTag feature="refund_seconds" size="sm" />{/if}
						{#if !heldMode && outcome.revokePending}
							<Badge tone="warning" dot>Revocation requested from importer</Badge>
						{:else if !heldMode}
							<TempoTag feature="key_revoked" size="sm" />
						{/if}
					</div>
				</section>
			{:else if !returned && c.state === 'settled'}
				<section class="block done">
					<div class="done-head">
						<CircleCheck size={18} strokeWidth={1.75} aria-hidden="true" />
						<strong>
							Settled: {formatMoney(units(c.chargesUnits ?? '0'))} to {c.lineName}{#if heldMode}, {formatMoney(
									units(c.refundUnits ?? '0')
								)} refunded{/if}
						</strong>
					</div>
					{#if !heldMode}
						{#if revokeRequested}
							<Badge tone="warning" dot>Revocation requested from importer</Badge>
						{:else}
							<TempoTag feature="key_revoked" size="sm" />
						{/if}
					{/if}
				</section>
			{/if}

			{#if error}<p class="err" role="alert">{error}</p>{/if}
		</div>
	{/if}

	{#snippet footer()}
		{#if outcome || (c && c.state !== 'returned')}
			<Button variant="secondary" onclick={() => (open = false)}>Close</Button>
		{:else}
			<Button variant="ghost" onclick={() => (open = false)} disabled={busy}>Cancel</Button>
			<Button
				variant="accent"
				loading={busy}
				loadingLabel="Settling"
				disabled={!!damageError || !returned}
				onclick={settle}
				data-testid="post-charges"
			>
				Post charges and settle
			</Button>
		{/if}
	{/snippet}
</Drawer>

<style>
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.link {
		margin-left: auto;
		font-size: var(--text-xs);
	}

	.block {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: var(--color-surface-sunken);
	}

	.block.done {
		border-color: var(--tone-success-border);
		background: var(--tone-success-bg);
	}

	.done-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--tone-success-fg);
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.sec-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.over {
		font-size: var(--text-2xs);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--color-text-tertiary);
	}

	.facts {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3) var(--space-4);
		margin: 0;
	}

	.facts dt {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
		margin-bottom: var(--space-0-5);
	}

	.facts dd {
		margin: 0;
		font-weight: var(--weight-medium);
	}

	.notice {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-3);
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-border-subtle);
		color: var(--color-text-secondary);
	}

	.notice :global(.field) {
		align-self: stretch;
	}

	.actions {
		display: flex;
		gap: var(--space-2);
	}

	.line {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		color: var(--color-text-secondary);
	}

	.line.strong {
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border-subtle);
		color: var(--color-text);
		font-weight: var(--weight-medium);
	}

	.split {
		display: flex;
		justify-content: space-between;
		gap: var(--space-4);
		padding-top: var(--space-2);
	}

	.split > div {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.right {
		align-items: flex-end;
		text-align: right;
	}

	.who {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.hint {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}

	.err {
		color: var(--tone-danger-fg);
		font-size: var(--text-xs);
	}
</style>
