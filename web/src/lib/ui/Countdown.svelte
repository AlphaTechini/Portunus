<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		durationParts,
		formatDateTime,
		formatDuration,
		isoString,
		toDate,
		type DateInput
	} from './format';

	interface Props {
		/** When the countdown ends (e.g. free-time end, settlement window end). */
		target: DateInput;
		/** Optional start, enables the progress bar (e.g. release time). */
		start?: DateInput;
		/** Label above the clock: "Free time ends in". */
		label?: string;
		/** Label once elapsed: "Free time ended". */
		elapsedLabel?: string;
		/** After the target, keep counting up (overdue time). */
		countUp?: boolean;
		/** Turn amber under this many ms. Default 24h. */
		warnWithin?: number;
		/** 'segments' big digits with units; 'inline' short text for tables. */
		variant?: 'segments' | 'inline';
		size?: 'sm' | 'md' | 'lg';
		/** Default: true for 'segments', false for 'inline' ("4d 6h" in tables, no ticking seconds). */
		showSeconds?: boolean;
		/** Show the absolute end time under the clock. */
		showTarget?: boolean;
		onElapsed?: () => void;
		/** Freeze at a given now (tests, screenshots, styleguide). */
		now?: number;
		class?: string;
	}

	let {
		target,
		start,
		label,
		elapsedLabel = 'Ended',
		countUp = false,
		warnWithin = 86_400_000,
		variant = 'segments',
		size = 'md',
		showSeconds: showSecondsProp,
		showTarget = false,
		onElapsed,
		now: frozen,
		class: className = ''
	}: Props = $props();

	const showSeconds = $derived(showSecondsProp ?? variant === 'segments');
	let tick = $state(Date.now());
	let fired = false;
	const current = $derived(frozen ?? tick);

	const end = $derived(toDate(target).getTime());
	const remaining = $derived(end - current);
	const elapsed = $derived(remaining <= 0);
	const parts = $derived(durationParts(remaining));
	const phase = $derived(elapsed ? 'elapsed' : remaining < warnWithin ? 'soon' : 'ok');
	const progress = $derived.by(() => {
		if (!start) return undefined;
		const s = toDate(start).getTime();
		const total = end - s;
		if (total <= 0) return 1;
		return Math.min(1, Math.max(0, (current - s) / total));
	});

	$effect(() => {
		if (frozen !== undefined) return;
		const id = setInterval(
			() => (tick = Date.now()),
			showSeconds || variant === 'segments' ? 1000 : 30_000
		);
		return () => clearInterval(id);
	});

	$effect(() => {
		if (elapsed && !fired && frozen === undefined) {
			fired = true;
			onElapsed?.();
		}
	});

	onDestroy(() => (fired = true));

	const pad = (n: number) => String(n).padStart(2, '0');
	const accessible = $derived(
		elapsed
			? countUp
				? `${elapsedLabel}, ${formatDuration(remaining, 'long')} ago`
				: elapsedLabel
			: `${label ?? 'Ends in'} ${formatDuration(remaining, 'long')}`
	);
</script>

<div class="cd {variant} {size} state-{phase} {className}">
	{#if label && variant === 'segments'}
		<span class="label">{elapsed ? elapsedLabel : label}</span>
	{/if}

	<time
		datetime={isoString(target)}
		class="clock tabular"
		role="timer"
		aria-live="off"
		aria-label={accessible}
	>
		{#if variant === 'inline'}
			{#if elapsed && !countUp}
				{elapsedLabel}
			{:else}
				{elapsed ? '+' : ''}{formatDuration(remaining, showSeconds ? 'clock' : 'short')}
			{/if}
		{:else if elapsed && !countUp}
			<span class="ended">{elapsedLabel}</span>
		{:else}
			{#if elapsed}<span class="sign" aria-hidden="true">+</span>{/if}
			{#if parts.days > 0}
				<span class="seg"><span class="v">{parts.days}</span><span class="u">d</span></span>
			{/if}
			<span class="seg"><span class="v">{pad(parts.hours)}</span><span class="u">h</span></span>
			<span class="seg"><span class="v">{pad(parts.minutes)}</span><span class="u">m</span></span>
			{#if showSeconds}
				<span class="seg"><span class="v">{pad(parts.seconds)}</span><span class="u">s</span></span>
			{/if}
		{/if}
	</time>

	{#if progress !== undefined && variant === 'segments'}
		<div class="track" aria-hidden="true">
			<div class="fill" style:width="{progress * 100}%"></div>
		</div>
	{/if}

	{#if showTarget && variant === 'segments'}
		<span class="target">{elapsed ? 'Ended' : 'Ends'} {formatDateTime(target)}</span>
	{/if}
</div>

<style>
	.cd {
		--fg: var(--color-text);
		--bar: var(--tone-success-solid);
		display: inline-flex;
		flex-direction: column;
		gap: var(--space-1-5);
		min-width: 0;
	}

	.state-soon {
		--fg: var(--tone-warning-fg);
		--bar: var(--tone-warning-solid);
	}

	.state-elapsed {
		--fg: var(--tone-caution-fg);
		--bar: var(--tone-caution-solid);
	}

	.label {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-text-secondary);
	}

	.clock {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35em;
		color: var(--fg);
		white-space: nowrap;
	}

	.inline .clock {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}

	.state-ok.inline .clock {
		color: var(--color-text);
	}

	.seg {
		display: inline-flex;
		align-items: baseline;
		gap: 1px;
	}

	.v {
		font-weight: var(--weight-semibold);
		letter-spacing: -0.02em;
	}

	.u,
	.sign {
		color: var(--color-text-tertiary);
		font-weight: var(--weight-medium);
	}

	.state-elapsed .sign {
		color: var(--fg);
	}

	/* the overdue "+" reads at the size of the units, not as a stray footnote mark */
	.sm .sign {
		font-size: var(--text-sm);
	}

	.md .sign {
		font-size: var(--text-lg);
	}

	.lg .sign {
		font-size: var(--text-2xl);
		font-weight: var(--weight-semibold);
	}

	.sm .v {
		font-size: var(--text-base);
	}

	.sm .u {
		font-size: var(--text-xs);
	}

	.md .v {
		font-size: var(--text-2xl);
		line-height: var(--leading-2xl);
	}

	.md .u {
		font-size: var(--text-sm);
	}

	.lg .v {
		font-size: var(--text-4xl);
		line-height: 1;
		letter-spacing: -0.03em;
	}

	.lg .u {
		font-size: var(--text-md);
	}

	.ended {
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
	}

	.track {
		height: 4px;
		border-radius: var(--radius-full);
		background: var(--color-surface-active);
		overflow: hidden;
		margin-top: var(--space-1);
	}

	.fill {
		height: 100%;
		border-radius: inherit;
		background: var(--bar);
		transition: width var(--duration-slow) var(--ease-out);
	}

	.target {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}
</style>
