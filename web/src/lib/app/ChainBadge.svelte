<script lang="ts">
	/**
	 * The one network indicator in the top bar (passed to AppShell as `network`). It names the
	 * network and is honest about the chain mode: "Simulated chain" in sim (Tempo Moderato rules,
	 * simulated in the app), "Tempo Moderato testnet" in live mode. Short form on phones.
	 */
	import { Tooltip, TEMPO_NETWORK } from '#lib/ui';
	import { useApp } from './ctx.svelte';

	const app = useApp();
</script>

<Tooltip
	placement="bottom"
	text={app.isSim
		? `${TEMPO_NETWORK.name} behaviour, simulated in this app. Transaction hashes carry a sim: prefix and have no explorer link. Fees are sponsored.`
		: `Transactions are real and final on the ${TEMPO_NETWORK.name}. Amounts and memos are public. Fees are sponsored by Portunus.`}
>
	<button
		type="button"
		class="chain"
		class:sim={app.isSim}
		data-testid="chain-badge"
		aria-label={app.isSim ? `Simulated chain, ${TEMPO_NETWORK.name}` : TEMPO_NETWORK.name}
	>
		<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
			<path d="M5 .8 9.2 5 5 9.2.8 5Z" fill="none" stroke="currentColor" stroke-width="1.2" />
			{#if app.isSim}<circle cx="5" cy="5" r="1.3" fill="currentColor" />{/if}
		</svg>
		<span class="long">{app.isSim ? 'Simulated chain' : TEMPO_NETWORK.name}</span>
		<span class="short" aria-hidden="true">{app.isSim ? 'Sim' : 'Testnet'}</span>
	</button>
</Tooltip>

<style>
	.chain {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 1.625rem;
		padding: 0 var(--space-2-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		color: var(--color-text-secondary);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		white-space: nowrap;
		cursor: help;
		transition: border-color var(--duration-fast) var(--ease-standard);
	}

	.chain:hover {
		border-color: var(--color-border-strong);
	}

	/* Simulated: dashed edge and the warning tone on the glyph, so it never passes for live. */
	.chain.sim {
		border-style: dashed;
		border-color: var(--color-border-strong);
	}

	.chain svg {
		color: var(--color-accent);
	}

	.chain.sim svg {
		color: var(--tone-warning-solid);
	}

	.chain:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
	}

	.short {
		display: none;
	}

	@media (max-width: 767px) {
		.long {
			display: none;
		}

		.short {
			display: inline;
		}
	}
</style>
