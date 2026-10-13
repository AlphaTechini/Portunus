<script lang="ts">
	/**
	 * The approval UX for payments and authorizations. Mounted once by the (app) layout; pages call
	 * `useApp().approve({...})` (see ctx.svelte.ts) and never mount it themselves.
	 *
	 *  - Person has a passkey: a real WebAuthn prompt over `payloadHash` (`approveWithPasskey`).
	 *  - Live chain and the request has `live`: that prompt signs the real transaction instead.
	 *  - Demo persona (no passkey): a passkey-styled confirm sheet with a short simulated biometric
	 *    animation and an explicit "Simulated approval (demo persona)" note.
	 *
	 * Resolves `{ approval, approvedWith }`. `approval` is exactly the object `deposits.payBatch` and
	 * `accessKeys.authorize` expect. Rejects with `ApprovalCancelledError` when the sheet is closed.
	 */
	import { onMount } from 'svelte';
	import Info from '@lucide/svelte/icons/info';
	import { Modal, Button, Money, PasskeyButton, TempoTag } from '#lib/ui';
	import { approveWithPasskey } from '#lib/tempo/passkey';
	import { useApp } from './ctx.svelte';
	import { ApprovalCancelledError, errorMessage } from './errors';
	import { units } from './format';
	import type { ApprovalRequest, ApprovalResult } from './approval';

	const app = useApp();

	type Pending = {
		req: ApprovalRequest;
		resolve: (r: ApprovalResult) => void;
		reject: (e: unknown) => void;
	};

	let open = $state(false);
	let pending = $state<Pending | null>(null);
	let phase = $state<'idle' | 'waiting' | 'success' | 'error'>('idle');
	let failure = $state('');

	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
	const simulated = $derived(!app.hasPasskey);
	const req = $derived(pending?.req);
	const amount = $derived(
		req?.amount === undefined
			? undefined
			: typeof req.amount === 'string'
				? units(req.amount)
				: req.amount
	);

	function request<T = unknown>(r: ApprovalRequest<T>): Promise<ApprovalResult<T>> {
		pending?.reject(new ApprovalCancelledError());
		return new Promise<ApprovalResult<T>>((resolve, reject) => {
			pending = {
				req: r as ApprovalRequest,
				resolve: resolve as (x: ApprovalResult) => void,
				reject
			};
			phase = 'idle';
			failure = '';
			open = true;
		});
	}

	onMount(() => {
		app._setApprover(request);
		return () => {
			app._setApprover(null);
			pending?.reject(new ApprovalCancelledError());
		};
	});

	function finish(result: ApprovalResult) {
		const p = pending;
		pending = null;
		open = false;
		p?.resolve(result);
	}

	function onclose() {
		// Closed by Escape, backdrop or Cancel while still pending: that is a cancellation.
		if (pending) {
			const p = pending;
			pending = null;
			p.reject(new ApprovalCancelledError());
		}
	}

	async function approve() {
		if (!pending || phase === 'waiting' || phase === 'success') return;
		const { payloadHash, live } = pending.req;
		phase = 'waiting';
		failure = '';
		try {
			if (app.hasPasskey && app.chainMode === 'live' && live) {
				const out = await live();
				phase = 'success';
				await sleep(450);
				finish({
					approvedWith: 'passkey',
					approval: {
						method: 'passkey',
						...(app.user.credentialId ? { credentialId: app.user.credentialId } : {}),
						payloadHash
					},
					live: out
				});
			} else if (app.hasPasskey) {
				const sig = await approveWithPasskey(
					payloadHash,
					app.user.credentialId ? { credentialId: app.user.credentialId } : undefined
				);
				phase = 'success';
				await sleep(450);
				finish({
					approvedWith: 'passkey',
					approval: {
						method: 'passkey',
						credentialId: sig.credentialId,
						payloadHash,
						assertion: {
							authenticatorData: sig.metadata.authenticatorData,
							clientDataJSON: sig.metadata.clientDataJSON,
							signatureR: sig.signature.r,
							signatureS: sig.signature.s,
							...(sig.metadata.userVerificationRequired !== undefined
								? { userVerificationRequired: sig.metadata.userVerificationRequired }
								: {})
						}
					}
				});
			} else if (app.isDemo) {
				await sleep(1500);
				phase = 'success';
				await sleep(600);
				finish({ approvedWith: 'demo', approval: { method: 'demo', payloadHash } });
			} else {
				throw new Error('no passkey');
			}
		} catch (e) {
			phase = 'error';
			failure =
				app.hasPasskey || app.isDemo
					? errorMessage(e, 'The approval was not completed. Try again.')
					: 'This account has no passkey. Sign in again with a passkey to approve.';
		}
	}
</script>

<Modal
	bind:open
	size="sm"
	title={req?.title ?? 'Approve with passkey'}
	description={req?.description}
	dismissible={phase !== 'waiting' && phase !== 'success'}
	{onclose}
>
	{#if req}
		<div class="sheet">
			{#if amount !== undefined}
				<div class="amount">
					<span class="k">{req.amountLabel ?? 'Amount'}</span>
					<Money {amount} size="xl" />
				</div>
			{/if}

			{#if req.details?.length}
				<dl class="rows">
					{#each req.details as d (d.label)}
						<div class="row">
							<dt>{d.label}</dt>
							<dd>{d.value}</dd>
						</div>
					{/each}
				</dl>
			{/if}

			<PasskeyButton
				fullWidth
				state={phase}
				label={req.confirmLabel ?? 'Approve with passkey'}
				sublabel={req.confirmSublabel ??
					(simulated ? 'Simulated Face ID' : 'Face ID, fingerprint or device PIN')}
				waitingLabel={simulated ? 'Verifying you (simulated)' : 'Waiting for your device'}
				successLabel="Approved"
				errorLabel="Not completed. Try again"
				onclick={approve}
			/>

			{#if phase === 'error' && failure}
				<p class="failure" role="alert">{failure}</p>
			{/if}

			{#if simulated}
				<p class="note">
					<Info size={14} strokeWidth={1.75} aria-hidden="true" />
					<span
						>Simulated approval (demo persona). A real account sees its device passkey prompt here.</span
					>
				</p>
			{/if}

			<div class="tags">
				<TempoTag feature="passkey" size="sm" />
				<TempoTag feature="fee_sponsored" size="sm" />
			</div>
		</div>
	{/if}

	{#snippet footer()}
		<Button
			variant="ghost"
			disabled={phase === 'waiting' || phase === 'success'}
			onclick={() => (open = false)}>Cancel</Button
		>
	{/snippet}
</Modal>

<style>
	.sheet {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.amount {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface-sunken);
	}

	.k {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.rows {
		display: flex;
		flex-direction: column;
	}

	.row {
		display: flex;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--color-border-subtle);
		font-size: var(--text-sm);
	}

	.row:last-child {
		border-bottom: 0;
	}

	dt {
		color: var(--color-text-secondary);
	}

	dd {
		color: var(--color-text);
		font-weight: var(--weight-medium);
		text-align: right;
	}

	.failure {
		font-size: var(--text-sm);
		color: var(--tone-danger-fg);
	}

	.note {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2-5) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--tone-neutral-bg);
		color: var(--tone-neutral-fg);
		font-size: var(--text-xs);
		line-height: var(--leading-xs);
	}

	.note :global(svg) {
		margin-top: 1px;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
</style>
