<script lang="ts">
	/**
	 * Developer playground for the shared approval sheet and chain result. Dev server only.
	 * Page agents: this is the reference for how to call `app.approve` and render `ChainResult`.
	 */
	import { dev } from '$app/env';
	import ShieldX from '@lucide/svelte/icons/shield-x';
	import { Button, Card, EmptyState, PageHeader } from '#lib/ui';
	import {
		ChainResult,
		errorMessage,
		isApprovalCancelled,
		useApp,
		type ApprovalResult
	} from '#lib/app';

	const app = useApp();
	const payloadHash = `0x${'ab'.repeat(32)}`;
	let result = $state<ApprovalResult | null>(null);
	let note = $state('');
	let busy = $state(false);

	async function ask() {
		busy = true;
		note = '';
		result = null;
		try {
			result = await app.approve({
				payloadHash,
				title: 'Approve payment',
				description: 'Playground request. Nothing is sent.',
				amount: 3_450_000_000n,
				amountLabel: 'Total to pay',
				details: [
					{ label: 'Containers', value: '3' },
					{ label: 'Paid to', value: 'Meridian Ocean Lines' }
				],
				confirmLabel: 'Pay 3 deposits',
				confirmSublabel: 'One transaction. Fees sponsored.'
			});
		} catch (e) {
			note = isApprovalCancelled(e) ? 'Cancelled.' : errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Approval playground · Portunus</title></svelte:head>

{#if !dev}
	<EmptyState
		icon={ShieldX}
		title="Not available"
		description="This page only exists on the dev server."
	/>
{:else}
	<PageHeader
		title="Approval playground"
		subtitle="Try the approval sheet and the chain result block."
	/>
	<div class="stack">
		<Card
			title="Approval sheet"
			description="Passkey users get the real prompt, demo personas a simulated one."
		>
			<Button variant="accent" loading={busy} onclick={ask} data-testid="ask-approval"
				>Request approval</Button
			>
			{#if note}<p data-testid="approval-note">{note}</p>{/if}
			{#if result}
				<pre class="mono" data-testid="approval-result">{JSON.stringify(result, null, 2)}</pre>
			{/if}
		</Card>
		<Card title="Chain result">
			<ChainResult txHash={`0x${'8f3a5c'.repeat(10)}1234`} finalityMs={482} tag />
		</Card>
	</div>
{/if}

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: var(--content-narrow);
	}

	pre {
		margin-top: var(--space-4);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--color-surface-sunken);
		font-size: var(--text-xs);
		overflow-x: auto;
	}
</style>
