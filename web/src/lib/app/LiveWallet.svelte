<script lang="ts">
	/**
	 * Live chain only: the importer's on-chain balance and a testnet faucet button. Renders nothing
	 * on the simulated chain, where demo importers start funded.
	 */
	import Coins from '@lucide/svelte/icons/coins';
	import { Button, Card, Hash, Money, toast } from '#lib/ui';
	import { faucet } from '../tempo/live.browser';
	import type { Address } from '../shared/tempo/live';
	import { useApp } from './ctx.svelte';
	import { errorMessage } from './errors';
	import { useLiveBalance } from './useLiveBalance.svelte';

	const app = useApp();
	const address = $derived(app.passkeySigner?.address ?? null);
	const balance = useLiveBalance(() => (app.chainMode === 'live' ? address : null));
	const symbol = $derived(app.status?.settlementTokenSymbol ?? 'AlphaUSD');
	let funding = $state(false);

	async function fund() {
		if (!address || funding) return;
		funding = true;
		try {
			const txs = await faucet(address as Address);
			await balance.refresh();
			toast.success('Testnet funds received', {
				description: `${txs.length} faucet ${txs.length === 1 ? 'transaction' : 'transactions'} on Tempo Moderato.`
			});
		} catch (e) {
			toast.error('The faucet did not complete', { description: errorMessage(e) });
		} finally {
			funding = false;
		}
	}
</script>

{#if app.chainMode === 'live' && address}
	<Card
		title="Your Tempo account"
		description="Live on Tempo Moderato. Your passkey is the only key to this account."
	>
		{#snippet actions()}
			<Button variant="secondary" icon={Coins} loading={funding} onclick={fund}>
				Get testnet funds
			</Button>
		{/snippet}
		<dl class="wallet" data-testid="live-wallet">
			<div>
				<dt>{symbol} balance</dt>
				<dd>
					{#if balance.units !== null}
						<Money amount={balance.units} size="lg" />
					{:else if balance.error}
						<span class="err">{balance.error}</span>
					{:else}
						<span class="muted">Loading…</span>
					{/if}
				</dd>
			</div>
			<div>
				<dt>Address</dt>
				<dd><Hash value={address} /></dd>
			</div>
		</dl>
	</Card>
{/if}

<style>
	.wallet {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: var(--space-4);
		margin: 0;
	}
	dt {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
		margin-bottom: var(--space-1);
	}
	dd {
		margin: 0;
	}
	.muted {
		color: var(--color-text-tertiary);
	}
	.err {
		color: var(--tone-danger-fg);
		font-size: var(--text-sm);
	}
</style>
