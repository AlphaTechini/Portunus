<script lang="ts">
	/**
	 * New release request (DESIGN 11.4, details 11.2): pick the importer and the deposit mode, enter
	 * the bill of lading and containers (check digits validated live), create the request. Each
	 * container gets its own virtual deposit address; the success state lives on the request page.
	 */
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
	import Plus from '@lucide/svelte/icons/plus';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import {
		Badge,
		Button,
		Card,
		EmptyState,
		Field,
		IconButton,
		Input,
		Money,
		PageHeader,
		SegmentedControl,
		Select,
		Skeleton,
		Textarea,
		TempoTag,
		containerCheckDigit,
		formatDays,
		formatMoney,
		normalizeContainerNumber,
		toast
	} from '#lib/ui';
	import { useAuthedMutation, useAuthedQuery } from '#lib/backend';
	import { api, errorMessage, lineRequestHref, units, useApp } from '#lib/app';

	type ContainerType = '20GP' | '40GP' | '40HC' | '20RF' | '40RF';
	type Mode = 'held' | 'depositFree';
	interface Row {
		key: number;
		number: string;
		type: ContainerType;
	}

	const TYPES: { value: ContainerType; label: string }[] = [
		{ value: '20GP', label: '20GP, 20 ft general purpose' },
		{ value: '40GP', label: '40GP, 40 ft general purpose' },
		{ value: '40HC', label: '40HC, 40 ft high cube' },
		{ value: '20RF', label: '20RF, 20 ft reefer' },
		{ value: '40RF', label: '40RF, 40 ft reefer' }
	];
	const MAX_CONTAINERS = 40;
	const PORTS: Record<string, string> = {
		Nigeria: 'Lagos (Apapa)',
		Kenya: 'Mombasa',
		Tanzania: 'Dar es Salaam',
		Philippines: 'Manila',
		Pakistan: 'Karachi',
		Ghana: 'Tema'
	};

	const app = useApp();
	const importers = useAuthedQuery(api.orgs.listImporters, {});
	const settings = useAuthedQuery(api.orgs.lineSettings, {});
	const create = useAuthedMutation(api.releaseRequests.create);

	let importerId = $state('');
	let mode = $state<Mode>('held');
	let billOfLading = $state('');
	let port = $state(PORTS[app.org.country] ?? '');
	let vessel = $state('');
	let voyage = $state('');
	let nextKey = 2;
	let rows = $state<Row[]>([{ key: 1, number: '', type: '40HC' }]);
	let pasteOpen = $state(false);
	let pasteText = $state('');
	let submitted = $state(false);
	let busy = $state(false);
	let formError = $state('');

	const importer = $derived(importers.data?.find((i) => i.orgId === importerId));
	const eligible = $derived(importer?.suggestedMode === 'depositFree');
	const cards = $derived(settings.data?.rateCards ?? []);
	const cardFor = (t: ContainerType) => cards.find((c) => c.containerType === t);
	const windowDays = $derived(settings.data?.settlementWindowDays ?? 3);
	const maxDetention = $derived(settings.data?.maxDetentionDays ?? 30);
	const provisioned = $derived(settings.data?.provisioned ?? true);

	// Choosing an importer applies the suggested mode; the line can still switch to held.
	$effect(() => {
		const imp = importer;
		untrack(() => {
			mode = imp?.suggestedMode ?? 'held';
		});
	});

	const importerOptions = $derived(
		(importers.data ?? []).map((i) => ({
			value: i.orgId,
			label: `${i.name}${i.relationship ? ` · ${i.relationship.cleanReturns} clean ${i.relationship.cleanReturns === 1 ? 'return' : 'returns'}` : ' · new importer'}`
		}))
	);

	// ---- container rows -----------------------------------------------------------------
	function check(row: Row, index: number) {
		const n = normalizeContainerNumber(row.number);
		if (!n) return { state: 'empty' as const, message: '', hint: '' };
		const dupe = rows.some((r, i) => i !== index && normalizeContainerNumber(r.number) === n);
		if (dupe) return { state: 'error' as const, message: 'This number is listed twice.', hint: '' };
		if (!cardFor(row.type))
			return {
				state: 'error' as const,
				message: `No rate card for ${row.type}. Add one in settings.`,
				hint: ''
			};
		if (n.length < 10) {
			return {
				state: 'partial' as const,
				message: '',
				hint: 'Owner code (3 letters and U, J or Z), then 6 digits, then the check digit.'
			};
		}
		if (!/^[A-Z]{3}[UJZ]\d{6}/.test(n))
			return {
				state: 'error' as const,
				message: 'A container number is 3 owner letters, U, J or Z, then 7 digits.',
				hint: ''
			};
		const expected = containerCheckDigit(n.slice(0, 10));
		if (n.length === 10)
			return {
				state: 'partial' as const,
				message: '',
				hint: `Check digit is ${expected}.`,
				fix: n + expected
			};
		if (n.length > 11 || !/^[A-Z]{3}[UJZ]\d{7}$/.test(n))
			return {
				state: 'error' as const,
				message: 'A container number has 11 characters.',
				hint: ''
			};
		if (Number(n[10]) !== expected)
			return {
				state: 'error' as const,
				message: `Check digit should be ${expected}.`,
				hint: '',
				fix: n.slice(0, 10) + expected
			};
		return { state: 'ok' as const, message: '', hint: '' };
	}

	const checks = $derived(rows.map((r, i) => check(r, i)));
	const okCount = $derived(checks.filter((c) => c.state === 'ok').length);
	const problemCount = $derived(
		checks.filter((c) => c.state === 'error' || c.state === 'partial').length
	);

	function addRow(number = '', type?: ContainerType) {
		if (rows.length >= MAX_CONTAINERS) return false;
		rows.push({ key: nextKey++, number, type: type ?? rows.at(-1)?.type ?? '40HC' });
		return true;
	}
	function removeRow(index: number) {
		rows.splice(index, 1);
		if (rows.length === 0) addRow();
	}
	/** Fill empty rows first, then append. */
	function addNumbers(tokens: string[], type?: ContainerType) {
		let added = 0;
		for (const t of tokens) {
			const n = normalizeContainerNumber(t);
			if (!n) continue;
			const empty = rows.find((r) => !normalizeContainerNumber(r.number));
			if (empty) empty.number = n;
			else if (!addRow(n, type)) {
				toast.warning(`A request holds at most ${MAX_CONTAINERS} containers.`);
				break;
			}
			added++;
		}
		return added;
	}
	const splitTokens = (text: string) => text.split(/[\s,;]+/).filter(Boolean);

	function onNumberPaste(e: ClipboardEvent, index: number) {
		const tokens = splitTokens(e.clipboardData?.getData('text') ?? '');
		if (tokens.length < 2) return;
		e.preventDefault();
		rows[index].number = normalizeContainerNumber(tokens[0]);
		const added = addNumbers(tokens.slice(1), rows[index].type);
		toast.show(`${added + 1} container numbers pasted`);
	}
	function addPasted() {
		const added = addNumbers(splitTokens(pasteText));
		if (added > 0) {
			pasteText = '';
			pasteOpen = false;
			toast.show(`${added} container ${added === 1 ? 'number' : 'numbers'} added`);
		}
	}

	// ---- summary ----------------------------------------------------------------------------
	const totals = $derived.by(() => {
		let deposit = 0n;
		let daily = 0n;
		let minFree = Infinity;
		let maxFree = 0;
		let counted = 0;
		for (const r of rows) {
			const c = cardFor(r.type);
			if (!c || !normalizeContainerNumber(r.number)) continue;
			counted++;
			deposit += units(c.depositUnits);
			daily += units(c.dailyRateUnits);
			minFree = Math.min(minFree, c.freeDays);
			maxFree = Math.max(maxFree, c.freeDays);
		}
		return { deposit, daily, counted, minFree: counted ? minFree : 0, maxFree };
	});
	const freeDaysText = $derived(
		totals.counted === 0
			? 'From the rate card'
			: totals.minFree === totals.maxFree
				? formatDays(totals.minFree)
				: `${totals.minFree} to ${totals.maxFree} days`
	);

	const missing = $derived.by(() => {
		const out: string[] = [];
		if (!importerId) out.push('Choose an importer');
		if (!billOfLading.trim()) out.push('Enter the bill of lading');
		if (!port.trim()) out.push('Enter the port of discharge');
		if (okCount === 0 && problemCount === 0) out.push('Add at least one container');
		if (problemCount > 0)
			out.push(`Fix ${problemCount} container ${problemCount === 1 ? 'number' : 'numbers'}`);
		if (!provisioned) out.push('Set up the deposits account');
		return out;
	});
	const canSubmit = $derived(missing.length === 0 && okCount > 0);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		submitted = true;
		formError = '';
		if (!canSubmit || busy) return;
		busy = true;
		try {
			const r = await create({
				importerOrgId: importerId as never,
				billOfLading: billOfLading.trim(),
				vessel: vessel.trim() || undefined,
				voyage: voyage.trim() || undefined,
				portOfDischarge: port.trim(),
				mode,
				containers: rows
					.filter((x) => normalizeContainerNumber(x.number))
					.map((x) => ({ number: normalizeContainerNumber(x.number), type: x.type }))
			});
			toast.success('Release request created', {
				description: `${r.containerIds.length} deposit ${r.containerIds.length === 1 ? 'address' : 'addresses'} generated.`
			});
			await goto(`${lineRequestHref(r.requestId)}?new=1`);
		} catch (err) {
			formError = errorMessage(err);
			toast.error('Could not create the request', { description: formError });
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>New release request · Portunus</title></svelte:head>

<PageHeader
	title="New release request"
	subtitle="Bill of lading, containers and deposit mode. Each container gets its own deposit address."
	breadcrumbs={[
		{ label: 'Dashboard', href: '/line' },
		{ label: 'Release requests', href: '/line/requests' },
		{ label: 'New release request' }
	]}
/>

<div class="layout">
	<form id="new-request" class="form" onsubmit={submit} novalidate>
		{#if settings.data && !provisioned}
			<Card variant="outline">
				<EmptyState
					icon={TriangleAlert}
					title="Set up the deposits account first"
					description="Requests need a deposits account with the receive policy configured."
				>
					{#snippet actions()}
						<Button href="/line/settings" variant="secondary">Open settings</Button>
					{/snippet}
				</EmptyState>
			</Card>
		{/if}

		<Card title="Importer" description="Who the containers are released to.">
			<div class="stack">
				{#if importers.isLoading}
					<Skeleton height="2.25rem" />
				{:else if importers.error}
					<EmptyState
						compact
						tone="error"
						title="Importers did not load"
						description={errorMessage(importers.error)}
					/>
				{:else}
					<Field
						label="Importer"
						required
						error={submitted && !importerId ? 'Choose an importer.' : undefined}
					>
						<Select
							bind:value={importerId}
							options={importerOptions}
							placeholder="Choose an importer"
						/>
					</Field>
				{/if}

				{#if importer}
					<div class="record" data-testid="track-record">
						<div class="record-badges">
							<Badge tone={importer.relationship?.cleanReturns ? 'success' : 'neutral'} dot>
								{importer.relationship?.cleanReturns ?? 0} clean
								{(importer.relationship?.cleanReturns ?? 0) === 1 ? 'return' : 'returns'}
							</Badge>
							{#if importer.relationship?.lateReturns}
								<Badge tone="caution" dot>
									{importer.relationship.lateReturns} late
									{importer.relationship.lateReturns === 1 ? 'return' : 'returns'}
								</Badge>
							{/if}
							{#if importer.openDisputes}
								<Badge tone="danger" dot>
									{importer.openDisputes} open {importer.openDisputes === 1
										? 'dispute'
										: 'disputes'}
								</Badge>
							{/if}
							<Badge tone="neutral">{importer.activeContainers} active containers</Badge>
						</div>
						<p class="record-text">
							{#if eligible}
								<strong
									>{importer.relationship?.cleanReturns} clean returns: eligible for deposit-free.</strong
								>
								The line asks for {importer.cleanReturnsForDepositFree}.
							{:else if importer.openDisputes}
								<strong>Held deposit suggested.</strong> A dispute is open, so deposit-free is not offered.
							{:else}
								<strong>Held deposit suggested.</strong>
								{importer.relationship?.cleanReturns ?? 0} of {importer.cleanReturnsForDepositFree} clean
								returns needed for deposit-free.
							{/if}
						</p>
					</div>
				{/if}

				<SegmentedControl
					variant="cards"
					label="Deposit mode"
					bind:value={mode}
					options={[
						{
							value: 'held',
							label: 'Held deposit',
							icon: ShieldCheck,
							description:
								'The deposit moves into the protocol guard. For new or unknown importers.'
						},
						{
							value: 'depositFree',
							label: 'Deposit-free',
							icon: KeyRound,
							disabled: !eligible,
							description: eligible
								? 'Nothing moves until a charge is owed. For importers with a clean record.'
								: importer
									? `Needs ${importer.cleanReturnsForDepositFree} clean returns and no open disputes.`
									: 'Choose an importer to see if they are eligible.'
						}
					]}
				/>

				<div class="moves" aria-live="polite">
					<h3 class="moves-title">What moves in this mode</h3>
					{#if mode === 'held'}
						<ol class="moves-list">
							<li>
								<span class="step">When the importer pays</span>
								<span>
									The full deposit ({totals.counted
										? formatMoney(totals.deposit)
										: 'per rate card'}) moves from the importer into the protocol guard. Your
									balance does not change.
								</span>
							</li>
							<li>
								<span class="step">During free time</span>
								<span>Nothing moves. Accrued detention counts against the held deposit.</span>
							</li>
							<li>
								<span class="step">After the return</span>
								<span>
									Approved charges go to your charges address and the remainder refunds to the
									importer in one transaction, within {formatDays(windowDays)}.
								</span>
							</li>
						</ol>
						<TempoTag
							feature="receive_policy"
							variant="callout"
							detail="Deposits land in the guard, not in your balance. Only the settlement contract can release them."
						/>
					{:else}
						<ol class="moves-list">
							<li>
								<span class="step">When the importer authorizes</span>
								<span>
									No cash moves. The importer approves an access key on their own account, capped at
									{totals.counted ? formatMoney(totals.daily) : 'one day of detention'} per day and payable
									only to your charges address.
								</span>
							</li>
							<li>
								<span class="step">After free time</span>
								<span>
									You pull one day of detention per day. The chain refuses a second pull on the same
									day. The key expires {maxDetention} days after free time ends.
								</span>
							</li>
							<li>
								<span class="step">After the return</span>
								<span>The key is revoked. The importer's money never left their account.</span>
							</li>
						</ol>
						<TempoTag
							feature="access_key"
							variant="callout"
							label="Access key: up to one day's detention per day, payable only to you"
							detail="Daily cap, your charges address as the only recipient, and an expiry, all enforced by the protocol."
						/>
					{/if}
				</div>
			</div>
		</Card>

		<Card
			title="Bill of lading"
			description="As issued by the line. Shown to the importer on the request."
		>
			<div class="grid-2">
				<Field
					label="Bill of lading"
					required
					error={submitted && !billOfLading.trim() ? 'Enter the bill of lading number.' : undefined}
				>
					<Input bind:value={billOfLading} mono placeholder="MRDNLOS26412" autocomplete="off" />
				</Field>
				<Field
					label="Port of discharge"
					required
					error={submitted && !port.trim() ? 'Enter the port of discharge.' : undefined}
				>
					<Input bind:value={port} placeholder="Lagos (Apapa)" list="ports" />
					<datalist id="ports">
						{#each Object.values(PORTS) as p (p)}<option value={p}></option>{/each}
					</datalist>
				</Field>
				<Field label="Vessel" hint="Optional">
					<Input bind:value={vessel} placeholder="MV Meridian Star" />
				</Field>
				<Field label="Voyage" hint="Optional">
					<Input bind:value={voyage} mono placeholder="026E" />
				</Field>
			</div>
		</Card>

		<Card
			title="Containers"
			description="Terms come from your rate card. Edit the rate card in settings."
		>
			{#snippet actions()}
				<Button
					variant="ghost"
					size="sm"
					icon={ClipboardPaste}
					onclick={() => (pasteOpen = !pasteOpen)}
					aria-expanded={pasteOpen}
				>
					Paste several
				</Button>
			{/snippet}

			{#if pasteOpen}
				<div class="paste">
					<Field
						label="Container numbers"
						hint="One per line, or separated by spaces or commas. They are checked as you add them."
					>
						<Textarea
							bind:value={pasteText}
							rows={4}
							class="mono"
							placeholder="MRDU 123456 5&#10;MRDU 123457 2"
						/>
					</Field>
					<div class="paste-actions">
						<Button variant="ghost" size="sm" onclick={() => (pasteOpen = false)}>Cancel</Button>
						<Button variant="secondary" size="sm" onclick={addPasted} disabled={!pasteText.trim()}>
							Add to list
						</Button>
					</div>
				</div>
			{/if}

			<div class="rows" role="group" aria-label="Containers">
				<div class="row head" aria-hidden="true">
					<span>Container number</span>
					<span>Size and type</span>
					<span class="r">Free days</span>
					<span class="r">Daily rate</span>
					<span class="r">{mode === 'held' ? 'Deposit' : 'Max exposure'}</span>
					<span></span>
				</div>
				{#each rows as row, i (row.key)}
					{@const ch = checks[i]}
					{@const card = cardFor(row.type)}
					<div class="row">
						<div class="cell number">
							<Input
								bind:value={row.number}
								mono
								size="md"
								placeholder="MRDU 123456 5"
								autocomplete="off"
								spellcheck={false}
								aria-label="Container number, row {i + 1}"
								invalid={ch.state === 'error' || (submitted && ch.state === 'empty')}
								onpaste={(e: ClipboardEvent) => onNumberPaste(e, i)}
							/>
							{#if ch.state === 'error'}
								<p class="msg error" role="alert">
									{ch.message}
									{#if ch.fix}
										<button type="button" class="fix" onclick={() => (row.number = ch.fix!)}>
											Use {ch.fix.slice(-1)}
										</button>
									{/if}
								</p>
							{:else if ch.state === 'ok'}
								<p class="msg ok">
									<CircleCheck size={12} strokeWidth={2} aria-hidden="true" /> Check digit matches
								</p>
							{:else if ch.state === 'partial'}
								<p class="msg">
									{ch.hint}
									{#if ch.fix}
										<button type="button" class="fix" onclick={() => (row.number = ch.fix!)}>
											Add it
										</button>
									{/if}
								</p>
							{:else if submitted}
								<p class="msg error" role="alert">Enter a container number.</p>
							{/if}
						</div>
						<div class="cell type">
							<Select
								bind:value={row.type}
								options={TYPES.map((t) => ({ value: t.value, label: t.value }))}
								aria-label="Size and type, row {i + 1}"
							/>
						</div>
						<div class="cell fig">
							<span class="mlabel">Free days</span>
							<span class="tabular">{card ? card.freeDays : '-'}</span>
						</div>
						<div class="cell fig">
							<span class="mlabel">Daily rate</span>
							{#if card}<Money amount={units(card.dailyRateUnits)} />{:else}-{/if}
						</div>
						<div class="cell fig">
							<span class="mlabel">{mode === 'held' ? 'Deposit' : 'Max exposure'}</span>
							{#if card}<Money amount={units(card.depositUnits)} />{:else}-{/if}
						</div>
						<div class="cell remove">
							<IconButton
								icon={Trash2}
								label="Remove container {i + 1}"
								variant="ghost"
								onclick={() => removeRow(i)}
							/>
						</div>
					</div>
				{/each}
			</div>
			<div class="add">
				<Button
					variant="ghost"
					size="sm"
					icon={Plus}
					onclick={() => addRow()}
					disabled={rows.length >= MAX_CONTAINERS}
				>
					Add container
				</Button>
				<span class="count tabular">
					{okCount} valid{problemCount ? `, ${problemCount} to fix` : ''}
				</span>
			</div>
			{#snippet footer()}
				<div class="va-note">
					<TempoTag feature="virtual_address" size="sm" />
					<span>A deposit address is generated for each container when you create the request.</span
					>
				</div>
			{/snippet}
		</Card>
	</form>

	<aside class="summary" aria-label="Request summary">
		<Card title="Summary">
			<dl class="sum">
				<div>
					<dt>Containers</dt>
					<dd class="tabular">{totals.counted}</dd>
				</div>
				<div>
					<dt>Free days</dt>
					<dd class="tabular">{freeDaysText}</dd>
				</div>
				<div>
					<dt>Daily detention</dt>
					<dd class="tabular">
						{#if totals.counted}<Money amount={totals.daily} />{:else}-{/if}
					</dd>
				</div>
				<div>
					<dt>Settlement window</dt>
					<dd class="tabular">{formatDays(windowDays)}</dd>
				</div>
			</dl>
			<div class="total">
				<span class="total-label">{mode === 'held' ? 'Total deposit' : 'Maximum exposure'}</span>
				<Money amount={totals.deposit} size="xl" dimCents />
				<span class="total-hint">
					{mode === 'held'
						? 'Held by the protocol guard once the importer pays.'
						: 'Nothing moves now. Pulled only as detention is owed.'}
				</span>
			</div>
			<p class="rule">
				{mode === 'held'
					? `Refund rule: after the empty is returned, the remainder goes back to the importer within ${formatDays(windowDays)}, automatically.`
					: 'Refund rule: nothing is held, so nothing is refunded. The key is revoked at settlement.'}
			</p>

			{#if formError}
				<p class="msg error" role="alert">{formError}</p>
			{/if}
			{#if submitted && missing.length}
				<ul class="missing" role="alert">
					{#each missing as m (m)}<li>{m}</li>{/each}
				</ul>
			{/if}

			{#snippet footer()}
				<Button
					type="submit"
					form="new-request"
					variant="primary"
					fullWidth
					loading={busy}
					loadingLabel="Creating request"
					disabled={!canSubmit && submitted}
				>
					Create request and generate addresses
				</Button>
			{/snippet}
		</Card>
	</aside>
</div>

<style>
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 320px;
		gap: var(--space-6);
		align-items: start;
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: 800px;
		min-width: 0;
	}

	.summary {
		position: sticky;
		top: calc(var(--topbar-height) + var(--space-4));
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-4);
	}

	.record {
		display: flex;
		flex-direction: column;
		gap: var(--space-2-5);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: var(--color-surface-sunken);
	}

	.record-badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.record-text {
		color: var(--color-text-secondary);
	}

	.record-text strong {
		color: var(--color-text);
		font-weight: var(--weight-semibold);
	}

	.moves {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.moves-title {
		font-size: var(--text-2xs);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--color-text-tertiary);
	}

	.moves-list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
	}

	.moves-list li {
		display: grid;
		grid-template-columns: 11rem minmax(0, 1fr);
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--color-border-subtle);
		color: var(--color-text-secondary);
	}

	.moves-list li:last-child {
		border-bottom: 0;
	}

	.step {
		font-weight: var(--weight-medium);
		color: var(--color-text);
	}

	.paste {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-bottom: var(--space-5);
		padding: var(--space-4);
		border: 1px dashed var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface-sunken);
	}

	.paste-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 1.7fr) 6.5rem 4.5rem 5.5rem 6.5rem 2.25rem;
		gap: var(--space-3);
		align-items: start;
	}

	.row.head {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-text-tertiary);
		align-items: end;
	}

	.r {
		text-align: right;
	}

	.cell {
		min-width: 0;
	}

	.fig {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		min-height: 2.25rem;
		white-space: nowrap;
	}

	.remove {
		display: flex;
		align-items: center;
		min-height: 2.25rem;
	}

	.mlabel {
		display: none;
	}

	.msg {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-1-5);
		margin-top: var(--space-1-5);
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.msg.error {
		color: var(--tone-danger-fg);
	}

	.msg.ok {
		color: var(--tone-success-fg);
	}

	.fix {
		padding: 0 var(--space-1-5);
		border: 1px solid currentColor;
		border-radius: var(--radius-xs);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-accent-text);
	}

	.add {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: var(--space-4);
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-border-subtle);
	}

	.va-note {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}

	.count {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.sum {
		display: flex;
		flex-direction: column;
		margin: 0;
	}

	.sum > div {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.sum dt {
		color: var(--color-text-secondary);
	}

	.sum dd {
		margin: 0;
		font-weight: var(--weight-medium);
	}

	.total {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-4) 0 var(--space-3);
	}

	.total-label {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.total-hint {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}

	.rule {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-border-subtle);
	}

	.missing {
		margin-top: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--tone-danger-bg);
		color: var(--tone-danger-fg);
		font-size: var(--text-xs);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	@media (max-width: 1100px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}

		.summary {
			position: static;
		}
	}

	@media (max-width: 760px) {
		.grid-2 {
			grid-template-columns: 1fr;
		}

		.moves-list li {
			grid-template-columns: 1fr;
			gap: var(--space-1);
		}

		.row.head {
			display: none;
		}

		.rows {
			gap: var(--space-4);
		}

		.row {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			padding: var(--space-3);
			border: 1px solid var(--color-border-subtle);
			border-radius: var(--radius-md);
		}

		.row .number {
			grid-column: 1 / -1;
		}

		.row .type {
			grid-column: 1 / 3;
		}

		.row .remove {
			grid-column: 3;
			grid-row: 2;
			justify-content: flex-end;
		}

		.fig {
			grid-column: span 1;
			flex-direction: column;
			align-items: flex-start;
			justify-content: flex-start;
			min-height: 0;
		}

		.mlabel {
			display: block;
			font-size: var(--text-xs);
			color: var(--color-text-tertiary);
		}
	}
</style>
