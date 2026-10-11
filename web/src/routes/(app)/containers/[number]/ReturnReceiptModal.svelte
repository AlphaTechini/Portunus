<script lang="ts">
	/**
	 * Importer: the silent-line rule. If the line never recorded the return, the importer submits the
	 * depot's return receipt. The line then has the settlement window to contest it.
	 */
	import { Button, Field, Input, Modal, formatDays, toast } from '#lib/ui';
	import { errorMessage, useProductNow } from '#lib/app';
	import { api } from '#lib/app';
	import { useAuthedMutation } from '#lib/backend';

	interface Props {
		open: boolean;
		containerId: string;
		number: string;
		releasedAt?: number;
		windowDays: number;
		/** The line's silent-line grace period (hours after the return date). */
		graceHours: number;
		ondone?: () => void;
	}
	let {
		open = $bindable(),
		containerId,
		number,
		releasedAt,
		windowDays,
		graceHours,
		ondone
	}: Props = $props();

	const clock = useProductNow(30_000);
	const submitReceipt = useAuthedMutation(api.containers.submitReturnReceipt);

	let eir = $state('');
	let depot = $state('');
	let date = $state('');
	let busy = $state(false);
	let touched = $state(false);
	let error = $state('');

	const isoDay = (ms: number) => {
		const d = new Date(ms);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	};
	const latestDay = $derived(isoDay(clock.value - graceHours * 3_600_000));
	const earliestDay = $derived(releasedAt ? isoDay(releasedAt) : undefined);

	$effect(() => {
		if (open) {
			eir = '';
			depot = '';
			date = '';
			error = '';
			touched = false;
		}
	});

	const dateMs = $derived(date ? new Date(`${date}T12:00:00`).getTime() : null);
	const errors = $derived({
		eir: eir.trim().length < 3 ? 'Enter the receipt number from the depot.' : '',
		depot: depot.trim().length < 2 ? 'Enter the depot.' : '',
		date: !date
			? 'Pick the return date.'
			: date > latestDay
				? `The return must be at least ${graceHours} ${graceHours === 1 ? 'hour' : 'hours'} old. The line still has time to record it.`
				: earliestDay && date < earliestDay
					? 'The return date is before the container was released.'
					: ''
	});

	async function submit() {
		touched = true;
		if (errors.eir || errors.depot || errors.date || dateMs === null) return;
		busy = true;
		error = '';
		try {
			await submitReceipt({
				containerId: containerId as never,
				eirNumber: eir.trim(),
				depot: depot.trim(),
				date: Math.min(dateMs, clock.value)
			});
			open = false;
			toast.success('Return receipt submitted', {
				description: `The line has ${formatDays(windowDays)} to contest it, or the refund proceeds.`
			});
			ondone?.();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<Modal bind:open title="Submit return receipt" description="Container {number}" dismissible={!busy}>
	<form
		class="form"
		onsubmit={(e) => {
			e.preventDefault();
			void submit();
		}}
	>
		<p class="rule">
			Use this only if the line has not recorded the return. The return date must be at least
			{graceHours}
			{graceHours === 1 ? 'hour' : 'hours'} old. The line then has {formatDays(windowDays)} to contest the receipt, or the
			settlement and refund proceed.
		</p>
		<Field label="Return receipt number (EIR)" error={touched ? errors.eir : ''}>
			<Input
				bind:value={eir}
				mono
				placeholder="As printed by the depot"
				invalid={touched && !!errors.eir}
			/>
		</Field>
		<Field label="Depot" error={touched ? errors.depot : ''}>
			<Input
				bind:value={depot}
				placeholder="Where the empty was returned"
				invalid={touched && !!errors.depot}
			/>
		</Field>
		<Field label="Return date" error={touched ? errors.date : ''}>
			<Input
				type="date"
				bind:value={date}
				max={latestDay}
				min={earliestDay}
				invalid={touched && !!errors.date}
			/>
		</Field>
		{#if error}<p class="err" role="alert">{error}</p>{/if}
	</form>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (open = false)} disabled={busy}>Cancel</Button>
		<Button variant="primary" loading={busy} onclick={submit} data-testid="submit-receipt">
			Submit receipt
		</Button>
	{/snippet}
</Modal>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.rule {
		margin: 0;
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--color-surface-sunken);
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
		line-height: var(--leading-xs);
	}
	.err {
		margin: 0;
		color: var(--tone-danger-fg);
	}
</style>
