<script lang="ts">
	/**
	 * Revoke a deposit-free access key (importer). Opens a confirm dialog with honest copy about
	 * what revoking means for the line's guarantee.
	 */
	import KeyRound from '@lucide/svelte/icons/key-round';
	import { Button, Modal, formatMoney, toast } from '#lib/ui';
	import { useAuthedAction } from '#lib/backend';
	import { api } from './api';
	import { errorMessage } from './errors';
	import { units } from './format';

	interface Props {
		containerId: string;
		number: string;
		lineName: string;
		/** Daily cap in base units, for the explanation. */
		dailyLimitUnits?: string;
		size?: 'sm' | 'md';
		onrevoked?: () => void;
	}
	let { containerId, number, lineName, dailyLimitUnits, size = 'sm', onrevoked }: Props = $props();

	const revoke = useAuthedAction(api.accessKeys.revoke);
	let open = $state(false);
	let busy = $state(false);
	let error = $state('');

	async function confirm() {
		busy = true;
		error = '';
		try {
			const r = await revoke({ containerId: containerId as never });
			open = false;
			toast.success('Access key revoked', {
				description: r.midFlight
					? `${lineName} can no longer pull detention for ${number}.`
					: `The key for ${number} is closed.`
			});
			onrevoked?.();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<Button
	variant="secondary"
	{size}
	icon={KeyRound}
	onclick={() => {
		error = '';
		open = true;
	}}
	data-testid="revoke-key"
>
	Revoke key
</Button>

<Modal
	bind:open
	title="Revoke this access key?"
	description="Container {number}"
	size="sm"
	dismissible={!busy}
>
	<div class="copy">
		<p>
			{lineName} will no longer be able to pull detention from your account for this container. Nothing
			already pulled is returned, and detention that keeps accruing after you revoke
			{#if dailyLimitUnits}(up to {formatMoney(units(dailyLimitUnits))} per day){/if} stays owed to the
			line and is no longer guaranteed.
		</p>
		<p>
			Revoking ends the line's guarantee, so it may ask for a held deposit on your next release
			request.
		</p>
		{#if error}<p class="err" role="alert">{error}</p>{/if}
	</div>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (open = false)} disabled={busy}>Keep the key</Button>
		<Button variant="danger" loading={busy} onclick={confirm} data-testid="confirm-revoke">
			Revoke key
		</Button>
	{/snippet}
</Modal>

<style>
	.copy {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		color: var(--color-text-secondary);
		line-height: var(--leading-sm);
	}
	.copy p {
		margin: 0;
	}
	.err {
		color: var(--tone-danger-fg);
	}
</style>
