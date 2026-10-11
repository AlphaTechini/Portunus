<script lang="ts">
	/**
	 * "Record return" drawer (details 11.7, DESIGN 11.8): EIR number, return date and depot, with a
	 * preview of what the return will cost. The settlement window opens once it is recorded.
	 */
	import { untrack } from 'svelte';
	import {
		Button,
		Drawer,
		Field,
		Input,
		Money,
		formatContainerNumber,
		formatDateTime,
		formatDays,
		formatMoney,
		toast
	} from '#lib/ui';
	import { useAuthedMutation } from '#lib/backend';
	import { api, errorMessage, units, useApp } from '#lib/app';
	import { accrued, detentionDaysAt, settlementAmounts } from '#lib/shared/domain/rules.ts';
	import SplitBar from './SplitBar.svelte';
	import { fromLocalInput, toLocalInput, type LineContainer } from './lineStatus.ts';

	interface Props {
		open: boolean;
		container: LineContainer | undefined;
		onrecorded?: (containerId: string) => void;
	}
	let { open = $bindable(false), container, onrecorded }: Props = $props();

	const app = useApp();
	const record = useAuthedMutation(api.containers.recordReturn);

	let eir = $state('');
	let depot = $state('');
	let when = $state('');
	let busy = $state(false);
	let error = $state('');
	let submitted = $state(false);
	let nowInput = $state('');

	const DEPOTS = [
		'Apapa Empty Depot',
		'Tin Can Empty Depot',
		'Ikorodu Empty Depot',
		'Mombasa Empty Depot'
	];

	// Reset the form each time the drawer opens for a container.
	$effect(() => {
		if (open && container) {
			untrack(() => {
				eir = '';
				depot = '';
				error = '';
				submitted = false;
				nowInput = toLocalInput(app.now());
				when = nowInput;
			});
		}
	});

	const c = $derived(container);
	const returnedAt = $derived(when ? fromLocalInput(when) : NaN);
	const dateError = $derived.by(() => {
		if (!Number.isFinite(returnedAt)) return 'Enter the return date.';
		if (returnedAt > app.now() + 60_000) return 'The return date cannot be in the future.';
		if (c?.releasedAt !== undefined && returnedAt < c.releasedAt)
			return 'The return date is before the container was released.';
		return '';
	});

	const preview = $derived.by(() => {
		if (!c || c.freeTimeEndsAt === undefined || !Number.isFinite(returnedAt)) return null;
		const days = detentionDaysAt(
			{ freeTimeEndsAt: c.freeTimeEndsAt, maxDetentionDays: c.maxDetentionDays, returnedAt },
			app.now()
		);
		const acc = accrued({
			days,
			dailyRateUnits: c.dailyRateUnits,
			depositUnits: c.depositUnits
		});
		if (c.mode === 'held') {
			const a = settlementAmounts({
				heldUnits: units(c.receivedUnits),
				depositUnits: c.depositUnits,
				accruedUnits: acc,
				damageUnits: 0n
			});
			return { days, accrued: acc, toLine: a.chargeUnits, refund: a.refundUnits };
		}
		const pulled = units(c.pulledUnits);
		return {
			days,
			accrued: acc,
			toLine: acc,
			refund: 0n,
			uncollected: acc > pulled ? acc - pulled : 0n
		};
	});

	async function submit() {
		submitted = true;
		error = '';
		if (!c || !eir.trim() || !depot.trim() || dateError) return;
		busy = true;
		try {
			const r = await record({
				containerId: c._id,
				eirNumber: eir.trim(),
				depot: depot.trim(),
				date: Math.min(returnedAt, app.now())
			});
			toast.success(`Return recorded for ${r.number}`, {
				description: r.settlementWindowEndsAt
					? `The settlement window is open until ${formatDateTime(r.settlementWindowEndsAt)}.`
					: undefined
			});
			open = false;
			onrecorded?.(r.containerId);
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<Drawer
	bind:open
	title={c ? `Record return of ${formatContainerNumber(c.number)}` : 'Record return'}
	description="Enter the depot's equipment interchange receipt. Recording it opens the settlement window."
	dismissible={!busy}
>
	{#if c}
		<form
			class="form"
			onsubmit={(e) => {
				e.preventDefault();
				void submit();
			}}
			novalidate
			id="record-return-form"
		>
			<Field
				label="Return receipt (EIR) number"
				required
				error={submitted && !eir.trim() ? 'Enter the EIR number.' : undefined}
			>
				<Input bind:value={eir} mono placeholder="EIR-LOS-482691" autocomplete="off" />
			</Field>
			<Field
				label="Depot"
				required
				error={submitted && !depot.trim() ? 'Enter the depot.' : undefined}
			>
				<Input bind:value={depot} placeholder="Apapa Empty Depot" list="depots" />
				<datalist id="depots">
					{#each DEPOTS as d (d)}<option value={d}></option>{/each}
				</datalist>
			</Field>
			<Field
				label="Return date and time"
				required
				hint="The empty's date at the depot. Detention stops here."
				error={submitted && dateError ? dateError : undefined}
			>
				<Input type="datetime-local" bind:value={when} max={nowInput} />
			</Field>

			{#if preview}
				<section class="preview" aria-label="Charge preview">
					<h3 class="over">If you post no damage</h3>
					<div class="line">
						<span>Detention</span>
						<span class="tabular">
							{formatDays(preview.days)}
							{#if preview.days > 0}at {formatMoney(units(c.dailyRateUnits))}{/if}
						</span>
					</div>
					<div class="line">
						<span>Accrued detention</span>
						<Money amount={preview.accrued} />
					</div>
					{#if c.mode === 'held'}
						<div class="split">
							<div>
								<span class="who">To {c.lineName}</span>
								<Money amount={preview.toLine} size="lg" />
							</div>
							<div class="right">
								<span class="who">Refund to {c.importerName}</span>
								<Money amount={preview.refund} size="lg" tone="positive" />
							</div>
						</div>
						<SplitBar
							toLine={Number(preview.toLine)}
							toImporter={Number(preview.refund)}
							lineLabel="To the line"
							importerLabel="Refund to the importer"
						/>
					{:else}
						<p class="note">
							Deposit-free: detention is collected by daily pulls on the access key.
							{#if preview.uncollected && preview.uncollected > 0n}
								{formatMoney(preview.uncollected)} is still to be pulled.
							{:else}
								Nothing further is owed.
							{/if}
							No refund, because no money was held.
						</p>
					{/if}
				</section>
			{/if}

			{#if error}<p class="err" role="alert">{error}</p>{/if}
		</form>
	{/if}
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (open = false)} disabled={busy}>Cancel</Button>
		<Button
			variant="primary"
			type="submit"
			form="record-return-form"
			loading={busy}
			loadingLabel="Recording"
		>
			Record return
		</Button>
	{/snippet}
</Drawer>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.preview {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: var(--color-surface-sunken);
	}

	.over {
		font-size: var(--text-2xs);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--color-text-tertiary);
	}

	.line {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		color: var(--color-text-secondary);
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

	.note {
		color: var(--color-text-secondary);
	}

	.err {
		color: var(--tone-danger-fg);
		font-size: var(--text-xs);
	}
</style>
