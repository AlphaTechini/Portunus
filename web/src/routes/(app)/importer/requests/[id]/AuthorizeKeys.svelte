<script lang="ts">
	/**
	 * Deposit-free mode: show exactly what the access key allows (daily cap, the line's charges
	 * address only, one day, expiry), say plainly that no money moves, then one action: Authorize.
	 */
	import type { FunctionReturnType } from 'convex/server';
	import Boxes from '@lucide/svelte/icons/boxes';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import ShieldOff from '@lucide/svelte/icons/shield-off';
	import {
		Button,
		Card,
		ContainerNumber,
		Hash,
		Money,
		Skeleton,
		StatusPill,
		TempoTag,
		formatDate,
		formatMoney
	} from '#lib/ui';
	import {
		ChainResult,
		ModeBadge,
		Notice,
		RevokeKeyButton,
		api,
		containerHref,
		errorMessage,
		isApprovalCancelled,
		units,
		useApp
	} from '#lib/app';
	import { useAuthedAction } from '#lib/backend';

	type Request = NonNullable<FunctionReturnType<typeof api.releaseRequests.get>>;
	type Prepared = FunctionReturnType<typeof api.accessKeys.prepare>;
	type Authorized = FunctionReturnType<typeof api.accessKeys.authorize>;
	let { data }: { data: Request } = $props();

	const app = useApp();
	const requestId = $derived(data.request._id);
	const prepare = useAuthedAction(api.accessKeys.prepare);
	const authorize = useAuthedAction(api.accessKeys.authorize);

	let prepared = $state<Prepared | null>(null);
	let preparing = $state(false);
	let prepareError = $state('');
	let authorizing = $state(false);
	let error = $state('');
	let result = $state<Authorized | null>(null);

	const needing = $derived(data.containers.filter((c) => c.state === 'requested'));
	const live = $derived(
		data.containers.filter((c) => c.accessKey && c.accessKey.status === 'active')
	);
	const keys = $derived(prepared?.keys ?? []);
	const symbol = $derived(app.status?.settlementTokenSymbol ?? 'AlphaUSD');
	const lineName = $derived(data.line.name);

	async function loadTerms() {
		if (preparing) return;
		preparing = true;
		prepareError = '';
		try {
			prepared = await prepare({ requestId });
		} catch (e) {
			prepareError = errorMessage(e);
		} finally {
			preparing = false;
		}
	}

	let started = false;
	$effect(() => {
		if (needing.length > 0 && !prepared && !started) {
			started = true;
			void loadTerms();
		}
	});

	const latestExpiry = $derived(keys.length ? Math.max(...keys.map((k) => k.expiry)) : 0);
	const tagLabel = $derived(
		keys.length
			? `Access key: up to one day's detention per day, payable only to ${lineName}, expires ${formatDate(latestExpiry)}`
			: undefined
	);

	async function authorizeAll() {
		if (!prepared || authorizing) return;
		error = '';
		try {
			const count = prepared.keys.length;
			const { approval } = await app.approve({
				payloadHash: prepared.payloadHash,
				title: count === 1 ? 'Authorize access key' : `Authorize ${count} access keys`,
				description: `No money moves. ${lineName} gets a capped daily right, payable only to its own charges address.`,
				details: [
					...prepared.keys.map((k) => ({
						label: k.number,
						value: `Up to ${formatMoney(units(k.dailyLimitUnits))} per day`
					})),
					{ label: 'Payable to', value: `${lineName} only` },
					{ label: 'Expires', value: formatDate(latestExpiry) }
				],
				confirmLabel: 'Authorize',
				confirmSublabel: 'No money moves. Fees sponsored.'
			});
			authorizing = true;
			result = await authorize({ requestId, approval });
		} catch (e) {
			if (!isApprovalCancelled(e)) error = errorMessage(e);
		} finally {
			authorizing = false;
		}
	}
</script>

<div class="col">
	{#if needing.length > 0}
		<Card
			title="What you are authorizing"
			description="An access key on your own account, held by {lineName}."
		>
			<div class="nomove">
				<span class="nm-icon" aria-hidden="true"><ShieldOff size={18} strokeWidth={1.9} /></span>
				<div>
					<p class="nm-title">No money moves</p>
					<p class="nm-sub">
						Your cash stays in your account. {lineName} can pull at most one day of detention per day
						after free time ends, and nothing to anyone else.
					</p>
				</div>
			</div>

			{#if preparing && keys.length === 0}
				<Skeleton lines={5} />
			{:else if prepareError}
				<Notice tone="danger" title="Could not prepare the access keys">
					{prepareError}
					{#snippet actions()}
						<Button variant="secondary" size="sm" onclick={loadTerms}>Try again</Button>
					{/snippet}
				</Notice>
			{:else if keys.length}
				<ul class="keys" data-testid="key-terms">
					{#each keys as k (k.containerId)}
						<li class="key">
							<div class="key-head">
								<ContainerNumber
									value={k.number}
									type={data.containers.find((c) => c._id === k.containerId)?.type}
									size="sm"
								/>
							</div>
							<dl class="terms">
								<div>
									<dt>Daily cap</dt>
									<dd>
										<Money amount={units(k.dailyLimitUnits)} size="lg" />
										<span class="unit">per day, resets daily</span>
									</dd>
								</div>
								<div>
									<dt>Period</dt>
									<dd>1 day</dd>
								</div>
								<div>
									<dt>Expires</dt>
									<dd>
										{formatDate(k.expiry)}
										<span class="unit">end of free time plus the maximum detention days</span>
									</dd>
								</div>
							</dl>
						</li>
					{/each}
				</ul>
				<dl class="common">
					<div>
						<dt>Payable to</dt>
						<dd>
							{lineName}, charges address only
							<Hash value={keys[0].recipient} kind="address" size="sm" />
						</dd>
					</div>
					<div>
						<dt>Currency</dt>
						<dd>{symbol}</dd>
					</div>
				</dl>
			{/if}
		</Card>

		{#if tagLabel}
			<TempoTag
				feature="access_key"
				variant="callout"
				label={tagLabel}
				detail="The protocol enforces the cap, the payee and the expiry. Revoke it any time."
			/>
		{/if}

		{#if error}
			<Notice tone="danger" title="Authorization did not go through" data-testid="authorize-error">
				{error}
			</Notice>
		{/if}

		<div class="act">
			<Button
				variant="accent"
				size="lg"
				fullWidth
				icon={KeyRound}
				loading={authorizing}
				loadingLabel="Waiting for the chain"
				disabled={keys.length === 0 || !!prepareError}
				onclick={authorizeAll}
				data-testid="authorize-keys"
			>
				Authorize
			</Button>
			<p class="foot"><TempoTag feature="passkey" size="sm" /> No money moves. Fees sponsored.</p>
		</div>
	{/if}

	{#if result}
		<div data-testid="authorize-success">
			<Card>
				<div class="done">
					<h2 class="done-title">
						{#if result.authorized.length === 1}
							Authorized: up to {formatMoney(units(result.authorized[0].dailyLimitUnits))} per day
						{:else}
							Authorized {result.authorized.length} access keys
						{/if}
					</h2>
					<p class="done-sub">No money moved. {lineName} can now issue the release order.</p>
				</div>
				<ul class="done-list">
					{#each result.authorized as a (a.containerId)}
						<li>
							<ContainerNumber value={a.number} size="sm" href={containerHref(a.number)} />
							<StatusPill
								state="authorized"
								label="Authorized: up to {formatMoney(units(a.dailyLimitUnits))} per day"
							/>
							<ChainResult
								txHash={a.txHash}
								finalityMs={a.finalityMs}
								compact
								toastTitle={result.authorized.length === 1 ? 'Authorized' : undefined}
								toastDescription={`Up to ${formatMoney(units(a.dailyLimitUnits))} per day, payable only to ${lineName}`}
							/>
						</li>
					{/each}
				</ul>
				{#if result.failed.length}
					<Notice tone="warning" title="Some keys were not authorized">
						{result.failed.map((f) => `${f.number}: ${f.error}`).join(' ')}
					</Notice>
				{/if}
			</Card>
		</div>
	{/if}

	{#if live.length > 0}
		<Card title="Active access keys" description="Keys you have authorized on this request.">
			<ul class="live">
				{#each live as c (c._id)}
					{@const k = c.accessKey!}
					<li class="live-row">
						<div class="live-main">
							<ContainerNumber
								value={c.number}
								type={c.type}
								size="sm"
								href={containerHref(c.number)}
							/>
							<StatusPill
								state={c.state === 'requested' ? 'authorized' : c.state}
								label={c.state === 'authorized'
									? `Authorized: up to ${formatMoney(units(k.dailyLimitUnits))} per day`
									: undefined}
							/>
						</div>
						<p class="live-sub">
							Up to {formatMoney(units(k.dailyLimitUnits))} per day, payable only to {lineName},
							expires
							{formatDate(k.expiry)}
						</p>
						<RevokeKeyButton
							containerId={c._id}
							number={c.number}
							{lineName}
							dailyLimitUnits={k.dailyLimitUnits}
						/>
					</li>
				{/each}
			</ul>
		</Card>
	{:else if needing.length === 0 && !result}
		<Card>
			<Notice tone="protocol" title="Nothing left to authorize" data-testid="already-authorized">
				Every container on this request is authorized or already out.
			</Notice>
			<div class="more">
				<Button variant="secondary" href="/containers" icon={Boxes}>View containers</Button>
			</div>
		</Card>
	{/if}

	<p class="mode"><ModeBadge mode="depositFree" size="sm" /></p>
</div>

<style>
	.col {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: 40rem;
		margin-inline: auto;
		width: 100%;
	}
	.nomove {
		display: flex;
		gap: var(--space-3);
		padding: var(--space-4);
		margin-bottom: var(--space-4);
		border: 1px solid var(--tone-protocol-border);
		border-radius: var(--radius-lg);
		background: var(--tone-protocol-bg);
	}
	.nm-icon {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--tone-protocol-fg);
		flex-shrink: 0;
	}
	.nm-title {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
		color: var(--color-text);
	}
	.nm-sub {
		margin: var(--space-1) 0 0;
		color: var(--color-text-secondary);
		line-height: var(--leading-sm);
	}
	.keys {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.key {
		padding: var(--space-4) 0;
		border-top: 1px solid var(--color-border-subtle);
	}
	.key:first-child {
		border-top: 0;
		padding-top: 0;
	}
	.key-head {
		margin-bottom: var(--space-3);
	}
	.terms,
	.common {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-4);
		margin: 0;
	}
	.common {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border-subtle);
	}
	dt {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
		margin-bottom: var(--space-1);
	}
	dd {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-0-5);
		color: var(--color-text);
	}
	.unit {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}
	.act {
		display: flex;
		flex-direction: column;
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
	.done-title {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
	}
	.done-sub {
		margin: var(--space-1) 0 0;
		color: var(--color-text-secondary);
	}
	.done-list,
	.live {
		list-style: none;
		margin: var(--space-4) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.done-list li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.live {
		margin-top: 0;
	}
	.live-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--space-1) var(--space-3);
		align-items: center;
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-border-subtle);
	}
	.live-row:first-child {
		border-top: 0;
		padding-top: 0;
	}
	.live-main {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.live-sub {
		grid-column: 1;
		margin: 0;
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}
	.live-row > :global(button) {
		grid-column: 2;
		grid-row: 1 / span 2;
	}
	.more {
		margin-top: var(--space-4);
	}
	.mode {
		display: none;
	}
	@media (max-width: 560px) {
		.terms {
			grid-template-columns: minmax(0, 1fr);
		}
		.common {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
