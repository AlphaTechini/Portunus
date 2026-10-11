<script lang="ts">
	/**
	 * Importer: dispute the posted charges, once. The disputed amount stays held by the settlement
	 * contract; everything undisputed settles immediately.
	 */
	import { Button, Field, Input, Modal, Textarea, formatMoney, toast } from '#lib/ui';
	import { errorMessage, fromUnits, toUnits, units, useApp } from '#lib/app';
	import { api } from '#lib/app';
	import { useAuthedAction } from '#lib/backend';

	interface Props {
		open: boolean;
		containerId: string;
		number: string;
		/** Most that can be disputed: the charge the line may take, in base units. */
		maxUnits: string;
		ondone?: () => void;
	}
	let { open = $bindable(), containerId, number, maxUnits, ondone }: Props = $props();

	const app = useApp();
	const dispute = useAuthedAction(api.disputes.open);
	let amount = $state('');
	let reason = $state('');
	let busy = $state(false);
	let error = $state('');

	$effect(() => {
		if (open) {
			amount = fromUnits(maxUnits);
			reason = '';
			error = '';
		}
	});

	const parsed = $derived.by(() => {
		try {
			return toUnits(String(amount));
		} catch {
			return null;
		}
	});
	const amountError = $derived(
		parsed === null || parsed <= 0n
			? 'Enter the amount you dispute.'
			: parsed > units(maxUnits)
				? `At most ${formatMoney(units(maxUnits))}, the charge posted against this container.`
				: ''
	);
	const reasonError = $derived(
		reason.trim().length < 3 ? 'Tell the resolver why you dispute it.' : ''
	);
	let touched = $state(false);

	async function submit() {
		touched = true;
		if (amountError || reasonError || parsed === null) return;
		busy = true;
		error = '';
		try {
			const r = await dispute({
				containerId: containerId as never,
				disputedUnits: parsed.toString(),
				reason: reason.trim()
			});
			open = false;
			toast.protocol('Dispute opened', {
				description: `${formatMoney(parsed)} stays held by the settlement contract. The rest settled immediately.`,
				txHash: r.txHash ? app.displayHash(r.txHash) : undefined
			});
			ondone?.();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<Modal
	bind:open
	title="Dispute charges"
	description="Container {number}. You can dispute once, inside the settlement window."
	dismissible={!busy}
>
	<form
		class="form"
		onsubmit={(e) => {
			e.preventDefault();
			void submit();
		}}
	>
		<Field
			label="Amount to dispute"
			hint="Up to {formatMoney(units(maxUnits))}, the most the line can charge on this container."
			error={touched ? amountError : ''}
		>
			<Input
				bind:value={amount}
				prefix="$"
				suffix="USD"
				numeric
				inputmode="decimal"
				invalid={touched && !!amountError}
			/>
		</Field>
		<Field label="Reason" error={touched ? reasonError : ''}>
			<Textarea
				bind:value={reason}
				maxlength={500}
				showCount
				rows={4}
				placeholder="What is wrong with the charge? The resolver reads this."
				invalid={touched && !!reasonError}
			/>
		</Field>
		<p class="note">
			Disputed funds stay held by the settlement contract until the resolver decides. Undisputed
			funds settle right away: the rest of the charge goes to the line and the remainder is refunded
			to you.
		</p>
		{#if error}<p class="err" role="alert">{error}</p>{/if}
	</form>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (open = false)} disabled={busy}>Cancel</Button>
		<Button variant="primary" loading={busy} onclick={submit} data-testid="submit-dispute">
			Open dispute
		</Button>
	{/snippet}
</Modal>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.note {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
		line-height: var(--leading-xs);
	}
	.err {
		margin: 0;
		color: var(--tone-danger-fg);
	}
</style>
