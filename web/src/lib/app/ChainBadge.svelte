<script lang="ts">
	/** Persistent, subtle chain-mode marker for the top bar: "Simulated chain" in sim, "Live chain" otherwise. */
	import { Tooltip } from '#lib/ui';
	import { useApp } from './ctx.svelte';

	const app = useApp();
</script>

<Tooltip
	placement="bottom"
	text={app.isSim
		? 'Chain behaviour is simulated in the app. Transaction hashes carry a sim: prefix and have no explorer link.'
		: 'Transactions are real and final on the Tempo testnet.'}
>
	<button type="button" class="chain" class:sim={app.isSim} data-testid="chain-badge">
		<span class="dot" aria-hidden="true"></span>
		<span class="long">{app.isSim ? 'Simulated chain' : 'Live chain'}</span>
		<span class="short" aria-hidden="true">{app.isSim ? 'Sim' : 'Live'}</span>
	</button>
</Tooltip>

<style>
	.chain {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 1.625rem;
		padding: 0 var(--space-2-5);
		border-radius: var(--radius-full);
		background: var(--tone-neutral-bg);
		color: var(--tone-neutral-fg);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		white-space: nowrap;
		cursor: help;
	}

	.chain:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--tone-success-solid);
	}

	.sim .dot {
		background: var(--tone-warning-solid);
	}

	.short {
		display: none;
	}

	@media (max-width: 767px) {
		.long {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
		}

		.short {
			display: inline;
		}
	}
</style>
