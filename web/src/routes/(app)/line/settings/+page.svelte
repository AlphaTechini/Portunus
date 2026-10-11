<script lang="ts">
	/**
	 * Line settings (DESIGN 11.3, details 7 and 9): the deposits account and its receive policy,
	 * the charges address, the settlement rules shown to importers, and the rate cards.
	 */
	import { untrack } from 'svelte';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Circle from '@lucide/svelte/icons/circle';
	import {
		Badge,
		Button,
		Card,
		EmptyState,
		Field,
		Hash,
		Input,
		PageHeader,
		SegmentedControl,
		Select,
		Skeleton,
		TempoTag,
		toast,
		type TableColumn
	} from '#lib/ui';
	import { useAuthedMutation, useAuthedQuery } from '#lib/backend';
	import { api, errorMessage } from '#lib/app';
	import { parseUsdToUnits, unitsToInput } from '#lib/app/line/lineStatus.ts';

	const settings = useAuthedQuery(api.orgs.lineSettings, {});
	const update = useAuthedMutation(api.orgs.updateLineSettings);
	const configure = useAuthedMutation(api.orgs.configureReceivePolicy);
	const upsert = useAuthedMutation(api.rateCards.upsert);

	const s = $derived(settings.data);

	// ---- rules form -----------------------------------------------------------------------------
	interface Rules {
		window: string;
		cleanReturns: string;
		maxDetention: string;
		grace: string;
		resolver: string;
	}
	const baseline = $derived<Rules | null>(
		s
			? {
					window: String(s.settlementWindowDays),
					cleanReturns: String(s.cleanReturnsForDepositFree),
					maxDetention: String(s.maxDetentionDays),
					grace: String(s.silentGraceHours),
					resolver: s.resolver?.orgId ?? ''
				}
			: null
	);
	let rules = $state<Rules | null>(null);
	let rulesKey = '';
	$effect(() => {
		// First load, and again after a save has landed (the baseline moved and nothing is pending).
		const b = baseline;
		if (!b) return;
		const key = JSON.stringify(b);
		untrack(() => {
			if (key === rulesKey) return;
			rulesKey = key;
			if (!rules || !rulesDirty) rules = { ...b };
		});
	});
	const rulesDirty = $derived(
		!!rules && !!baseline && JSON.stringify(rules) !== JSON.stringify(baseline)
	);

	const intIn = (v: string, min: number, max: number) =>
		/^\d+$/.test(v.trim()) && +v >= min && +v <= max;
	const errs = $derived({
		window: rules && !intIn(rules.window, 1, 30) ? 'Enter a whole number from 1 to 30.' : '',
		cleanReturns:
			rules && !intIn(rules.cleanReturns, 1, 50) ? 'Enter a whole number from 1 to 50.' : '',
		maxDetention:
			rules && !intIn(rules.maxDetention, 1, 120) ? 'Enter a whole number from 1 to 120.' : '',
		grace: rules && !intIn(rules.grace, 0, 168) ? 'Enter a whole number from 0 to 168.' : ''
	});
	const rulesValid = $derived(!Object.values(errs).some(Boolean));

	const preset = $derived(
		rules?.window === '3' ? 'default' : rules?.window === '15' ? 'philippines' : 'custom'
	);
	function setPreset(p: string) {
		if (!rules) return;
		if (p === 'default') rules.window = '3';
		else if (p === 'philippines') rules.window = '15';
		else if (rules.window === '3' || rules.window === '15') rules.window = '7';
	}

	let savingRules = $state(false);
	async function saveRules() {
		if (!rules || !baseline || !rulesValid || savingRules) return;
		savingRules = true;
		try {
			await update({
				settlementWindowDays: +rules.window,
				cleanReturnsForDepositFree: +rules.cleanReturns,
				maxDetentionDays: +rules.maxDetention,
				silentGraceHours: +rules.grace,
				resolverOrgId: (rules.resolver || undefined) as never
			});
			toast.success('Settlement rules saved', {
				description: `Importers now see a ${rules.window}-day settlement window.`
			});
		} catch (e) {
			toast.error('Could not save the rules', { description: errorMessage(e) });
		} finally {
			savingRules = false;
		}
	}

	// ---- rate cards ---------------------------------------------------------------------------------
	const TYPES = [
		{ value: '20GP', label: '20GP', note: '20 ft general purpose' },
		{ value: '40GP', label: '40GP', note: '40 ft general purpose' },
		{ value: '40HC', label: '40HC', note: '40 ft high cube' },
		{ value: '20RF', label: '20RF', note: '20 ft reefer' },
		{ value: '40RF', label: '40RF', note: '40 ft reefer' }
	] as const;
	type CType = (typeof TYPES)[number]['value'];
	interface Rate {
		freeDays: string;
		daily: string;
		deposit: string;
	}
	const rateBase = $derived<Record<CType, Rate> | null>(
		s
			? (Object.fromEntries(
					TYPES.map((t) => {
						const c = s.rateCards.find((x) => x.containerType === t.value);
						return [
							t.value,
							c
								? {
										freeDays: String(c.freeDays),
										daily: unitsToInput(c.dailyRateUnits),
										deposit: unitsToInput(c.depositUnits)
									}
								: { freeDays: '', daily: '', deposit: '' }
						];
					})
				) as Record<CType, Rate>)
			: null
	);
	let rates = $state<Record<CType, Rate> | null>(null);
	let ratesKey = '';
	$effect(() => {
		const b = rateBase;
		if (!b) return;
		const key = JSON.stringify(b);
		untrack(() => {
			if (key === ratesKey) return;
			ratesKey = key;
			if (!rates || !ratesDirty) rates = structuredClone(b);
		});
	});
	const rowDirty = (t: CType) =>
		!!rates && !!rateBase && JSON.stringify(rates[t]) !== JSON.stringify(rateBase[t]);
	const ratesDirty = $derived(TYPES.some((t) => rowDirty(t.value)));

	function rateErrors(t: CType) {
		const r = rates?.[t];
		const out = { freeDays: '', daily: '', deposit: '' };
		if (!r || !rowDirty(t)) return out;
		if (!intIn(r.freeDays, 0, 60)) out.freeDays = 'Whole days, 0 to 60.';
		const d = parseUsdToUnits(r.daily);
		if (!d || d <= 0n) out.daily = 'Enter an amount above 0.';
		const p = parseUsdToUnits(r.deposit);
		if (!p || p <= 0n) out.deposit = 'Enter an amount above 0.';
		return out;
	}
	const ratesValid = $derived(
		TYPES.every((t) => !Object.values(rateErrors(t.value)).some(Boolean))
	);

	let savingRates = $state(false);
	async function saveRates() {
		if (!rates || !ratesValid || savingRates) return;
		savingRates = true;
		let saved = 0;
		try {
			for (const t of TYPES) {
				if (!rowDirty(t.value)) continue;
				const r = rates[t.value];
				await upsert({
					containerType: t.value,
					freeDays: +r.freeDays,
					dailyRateUnits: (parseUsdToUnits(r.daily) ?? 0n).toString(),
					depositUnits: (parseUsdToUnits(r.deposit) ?? 0n).toString()
				});
				saved++;
			}
			toast.success('Rate card saved', {
				description: `${saved} container ${saved === 1 ? 'type' : 'types'} updated. New requests use these terms.`
			});
		} catch (e) {
			toast.error('Could not save the rate card', { description: errorMessage(e) });
		} finally {
			savingRates = false;
		}
	}

	// ---- deposits account ------------------------------------------------------------------------
	let configuring = $state(false);
	async function configurePolicy() {
		if (configuring) return;
		configuring = true;
		try {
			await configure({});
			toast.protocol('Receive policy configured', {
				description:
					'Deposits now land in the guard, with the settlement contract as recovery authority.'
			});
		} catch (e) {
			toast.error('Could not configure the receive policy', { description: errorMessage(e) });
		} finally {
			configuring = false;
		}
	}

	const setup = $derived([
		{ label: 'Create the deposits account', done: !!s?.depositsAccount },
		{ label: 'Set the receive policy', done: !!s?.receivePolicy },
		{
			label: 'Set the settlement contract as recovery authority',
			done: !!s?.settlementContract && !!s?.receivePolicy
		}
	]);

	const rateCols: TableColumn[] = [
		{ key: 'type', label: 'Container type', width: '28%' },
		{ key: 'free', label: 'Free days' },
		{ key: 'daily', label: 'Daily detention' },
		{ key: 'deposit', label: 'Deposit' }
	];
</script>

<svelte:head><title>Settings · Portunus</title></svelte:head>

<PageHeader title="Settings" subtitle="Deposits account, charges address and default terms." />

{#if settings.error}
	<Card>
		<EmptyState
			tone="error"
			title="Settings did not load"
			description={errorMessage(settings.error)}
		/>
	</Card>
{:else}
	<div class="sections">
		<!-- 1. Deposits account -->
		<section class="section" aria-labelledby="sec-deposits">
			<div class="intro">
				<h2 id="sec-deposits">Deposits account</h2>
				<p>
					Where importers pay held deposits. The receive policy keeps every deposit out of your
					balance.
				</p>
			</div>
			<div class="stackcol">
				{#if !s}
					<Card><Skeleton lines={5} /></Card>
				{:else if !s.provisioned}
					<Card>
						<EmptyState
							icon={ShieldCheck}
							title="Set up the deposits account"
							description="Create the account, set the receive policy and name the settlement contract as recovery authority. Importers cannot pay until this is done."
						>
							{#snippet actions()}
								<Button
									variant="primary"
									loading={configuring}
									loadingLabel="Configuring"
									onclick={configurePolicy}
									data-testid="configure-policy"
								>
									Configure receive policy
								</Button>
							{/snippet}
						</EmptyState>
						<ul class="steps" aria-label="Setup progress">
							{#each setup as step (step.label)}
								<li class:done={step.done}>
									{#if step.done}
										<CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" />
									{:else}
										<Circle size={16} strokeWidth={1.75} aria-hidden="true" />
									{/if}
									<span>{step.label}</span>
								</li>
							{/each}
						</ul>
					</Card>
				{:else}
					<Card>
						<dl class="rows">
							<div class="row">
								<dt>Deposits account</dt>
								<dd>
									{#if s.depositsAccount}<Hash
											value={s.depositsAccount}
											kind="address"
											head={8}
											tail={6}
										/>{/if}
								</dd>
							</div>
							<div class="row">
								<dt>Receive policy</dt>
								<dd>
									<Badge tone="protocol" dot>Active: deposits held by the guard</Badge>
								</dd>
							</div>
							<div class="row">
								<dt>Recovery authority</dt>
								<dd>
									{#if s.settlementContract}
										<Hash value={s.settlementContract} kind="address" head={8} tail={6} />
									{/if}
									<span class="sub">The settlement contract</span>
								</dd>
							</div>
							<div class="row">
								<dt>Virtual address master</dt>
								<dd>
									{#if s.masterId}<span class="mono">{s.masterId}</span>{/if}
									<span class="sub">
										{s.chainMode === 'live'
											? s.masterRegistered
												? 'Registered on Tempo'
												: 'Not registered yet'
											: 'Registered in the simulated chain'}
									</span>
								</dd>
							</div>
						</dl>
						<div class="callouts">
							<TempoTag
								feature="receive_policy"
								variant="callout"
								detail="Rejects incoming balance credit. Deposits are held by the protocol guard and are recoverable only by the settlement contract."
							/>
							<div class="tagrow">
								<TempoTag feature="recovery_authority" size="sm" />
								<TempoTag feature="virtual_address" size="sm" />
							</div>
						</div>
					</Card>

					<Card
						title="Charges address"
						description="Detention and approved charges are paid here. Access keys can pay only this address."
					>
						{#if s.chargesAddress}<Hash value={s.chargesAddress} kind="address" full />{/if}
					</Card>
				{/if}
			</div>
		</section>

		<!-- 2. Settlement rules -->
		<section class="section" aria-labelledby="sec-rules">
			<div class="intro">
				<h2 id="sec-rules">Settlement rules</h2>
				<p>
					Fixed and shown to the importer before they pay. Changes apply to new release requests.
				</p>
			</div>
			<div class="stackcol">
				<Card
					title="Settlement window"
					description="After the empty is returned, you have this long to post final charges. Then the remainder refunds automatically."
				>
					{#if !rules}
						<Skeleton lines={4} />
					{:else}
						<div class="form">
							<SegmentedControl
								label="Settlement window presets"
								value={preset}
								onchange={setPreset}
								options={[
									{ value: 'default', label: '3 days' },
									{ value: 'philippines', label: '15 days' },
									{ value: 'custom', label: 'Custom' }
								]}
							/>
							<p class="preset-note">
								{preset === 'default'
									? '3 days is the default.'
									: preset === 'philippines'
										? '15 days matches the Philippines draft rule: refunds within 15 days of the empty-return receipt.'
										: 'Pick any whole number of days from 1 to 30.'}
							</p>
							<div class="grid">
								<Field label="Window" error={errs.window || undefined}>
									<Input
										bind:value={rules.window}
										numeric
										suffix="days"
										aria-label="Settlement window in days"
										data-testid="window-days"
									/>
								</Field>
								<Field
									label="Maximum detention"
									hint="Detention stops accruing after this many days."
									error={errs.maxDetention || undefined}
								>
									<Input bind:value={rules.maxDetention} numeric suffix="days" />
								</Field>
								<Field
									label="Silent line grace"
									hint="After this long without a recorded return, the importer can submit the receipt."
									error={errs.grace || undefined}
								>
									<Input bind:value={rules.grace} numeric suffix="hours" />
								</Field>
								<Field label="Dispute resolver" hint="Both sides agree to this resolver up front.">
									<Select
										bind:value={rules.resolver}
										options={(s?.resolverChoices ?? []).map((r) => ({
											value: r.orgId,
											label: r.name
										}))}
									/>
								</Field>
							</div>
						</div>
					{/if}
				</Card>

				<Card
					title="Deposit-free eligibility"
					description="Importers with enough clean returns can be released against an access key instead of a deposit."
				>
					{#if !rules}
						<Skeleton lines={2} />
					{:else}
						<div class="form">
							<Field
								label="Clean returns needed"
								hint="A clean return is on time and not disputed. The importer is then offered deposit-free."
								error={errs.cleanReturns || undefined}
								class="narrow"
							>
								<Input bind:value={rules.cleanReturns} numeric suffix="returns" />
							</Field>
						</div>
					{/if}
					{#snippet footer()}
						<span>{rulesDirty ? 'You have unsaved changes.' : 'All changes saved.'}</span>
						<Button
							variant="primary"
							loading={savingRules}
							loadingLabel="Saving"
							disabled={!rulesDirty || !rulesValid}
							onclick={saveRules}
							data-testid="save-rules"
						>
							Save settings
						</Button>
					{/snippet}
				</Card>
			</div>
		</section>

		<!-- 3. Rate cards -->
		<section class="section wide" aria-labelledby="sec-rates">
			<div class="intro">
				<h2 id="sec-rates">Rate card</h2>
				<p>
					Free days, daily detention and the deposit per container type. New release requests fill
					their terms from here.
				</p>
			</div>
			<div class="stackcol">
				<Card padding="none" title="Terms per container type">
					{#if !rates}
						<div class="pad"><Skeleton lines={5} /></div>
					{:else}
						<div class="scroller">
							<table class="rates">
								<caption class="sr-only">Rate card by container type</caption>
								<thead>
									<tr>
										{#each rateCols as c (c.key)}<th scope="col" style:width={c.width}>{c.label}</th
											>{/each}
									</tr>
								</thead>
								<tbody>
									{#each TYPES as t (t.value)}
										{@const e = rateErrors(t.value)}
										<tr data-testid="rate-row-{t.value}" class:dirty={rowDirty(t.value)}>
											<th scope="row">
												<span class="type">{t.label}</span>
												<span class="sub">{t.note}</span>
											</th>
											<td data-label="Free days">
												<Field
													label="Free days for {t.label}"
													hideLabel
													error={e.freeDays || undefined}
												>
													<Input
														bind:value={rates[t.value].freeDays}
														numeric
														suffix="days"
														placeholder="0"
													/>
												</Field>
											</td>
											<td data-label="Daily detention">
												<Field
													label="Daily detention for {t.label}"
													hideLabel
													error={e.daily || undefined}
												>
													<Input
														bind:value={rates[t.value].daily}
														numeric
														prefix="$"
														placeholder="0.00"
													/>
												</Field>
											</td>
											<td data-label="Deposit">
												<Field
													label="Deposit for {t.label}"
													hideLabel
													error={e.deposit || undefined}
												>
													<Input
														bind:value={rates[t.value].deposit}
														numeric
														prefix="$"
														placeholder="0.00"
													/>
												</Field>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
					{#snippet footer()}
						<span>{ratesDirty ? 'You have unsaved changes.' : 'All changes saved.'}</span>
						<Button
							variant="primary"
							loading={savingRates}
							loadingLabel="Saving"
							disabled={!ratesDirty || !ratesValid}
							onclick={saveRates}
							data-testid="save-rates"
						>
							Save rate card
						</Button>
					{/snippet}
				</Card>
			</div>
		</section>
	</div>
{/if}

<style>
	.sections {
		display: flex;
		flex-direction: column;
		gap: var(--space-10);
		max-width: 960px;
	}

	.section {
		min-width: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
		gap: var(--space-6);
		align-items: start;
	}

	.section.wide {
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
	}

	.intro h2 {
		font-size: var(--text-base);
		line-height: var(--leading-base);
		margin-bottom: var(--space-1-5);
	}

	.intro p {
		color: var(--color-text-secondary);
	}

	.stackcol {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}

	.rows {
		display: flex;
		flex-direction: column;
		margin: calc(var(--space-2) * -1) 0 0;
	}

	.row {
		display: grid;
		grid-template-columns: 11rem minmax(0, 1fr);
		gap: var(--space-4);
		align-items: baseline;
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.row dt {
		color: var(--color-text-secondary);
	}

	.row dd {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
		margin: 0;
		min-width: 0;
	}

	.sub {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
		font-weight: var(--weight-regular);
	}

	.callouts {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-top: var(--space-5);
	}

	.tagrow {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.steps {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-width: 22rem;
		margin: var(--space-2) auto 0;
	}

	.steps li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-text-tertiary);
	}

	.steps li.done {
		color: var(--tone-success-fg);
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.preset-note {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
		margin-top: calc(var(--space-2) * -1);
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-4);
	}

	:global(.narrow) {
		max-width: 14rem;
	}

	.pad {
		padding: var(--space-5);
	}

	.scroller {
		position: relative;
		overflow-x: auto;
	}

	.rates {
		width: 100%;
		min-width: 34rem;
		table-layout: fixed;
		border-collapse: separate;
		border-spacing: 0;
		font-size: var(--text-sm);
	}

	.rates th {
		padding: 0 var(--space-4);
		height: 2.25rem;
		text-align: left;
		background: var(--color-surface-sunken);
		border-top: 1px solid var(--color-border-subtle);
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text-tertiary);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		white-space: nowrap;
	}

	.rates td,
	.rates tbody th {
		padding: var(--space-2-5) var(--space-4);
		border-bottom: 1px solid var(--color-border-subtle);
		vertical-align: top;
	}

	.rates tbody th {
		height: auto;
		background: transparent;
		border-top: 0;
		color: var(--color-text);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		white-space: normal;
		padding-top: var(--space-4);
	}

	.rates tbody tr:last-child td,
	.rates tbody tr:last-child th {
		border-bottom: 0;
	}

	.rates tr.dirty td,
	.rates tr.dirty th {
		background: var(--color-accent-subtle);
	}

	.type {
		display: block;
		font-family: var(--font-mono);
	}

	/* Phones: one block per container type, its three inputs side by side with their labels. */
	@media (max-width: 560px) {
		.rates,
		.rates tbody {
			display: block;
			min-width: 0;
		}

		.rates thead {
			display: none;
		}

		.rates tr {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: var(--space-2);
			padding: var(--space-3) var(--space-4);
			border-bottom: 1px solid var(--color-border-subtle);
		}

		.rates tbody tr:last-child {
			border-bottom: 0;
		}

		.rates td,
		.rates tbody th {
			display: block;
			padding: 0;
			border: 0;
		}

		.rates tbody th {
			grid-column: 1 / -1;
		}

		.rates td::before {
			content: attr(data-label);
			display: block;
			margin-bottom: var(--space-1);
			font-size: var(--text-xs);
			color: var(--color-text-tertiary);
		}
	}

	@media (max-width: 860px) {
		.section {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--space-3);
		}
	}

	@media (max-width: 560px) {
		.grid {
			grid-template-columns: 1fr;
		}

		.row {
			grid-template-columns: 1fr;
			gap: var(--space-1);
		}
	}
</style>
