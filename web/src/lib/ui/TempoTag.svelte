<script lang="ts">
	import type { Snippet } from 'svelte';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Tooltip from './Tooltip.svelte';
	import { TEMPO_FEATURES, TEMPO_PROTOCOL_NOTE, type TempoFeatureKey } from './tempo';

	interface Props {
		/** Registry key from tempo.ts. Supplies label, TIP, tooltip and docs link. */
		feature?: TempoFeatureKey;
		/** Override the on-screen label (for dynamic labels with amounts or dates). */
		label?: string;
		/** Override / supply the TIP reference, e.g. "TIP-1022". Pass null to hide. */
		tip?: string | null;
		/** Override the tooltip body. */
		description?: string;
		/** Override the docs link. */
		href?: string;
		/** 'tag' is the inline chip; 'callout' is a block with a detail line. */
		variant?: 'tag' | 'callout';
		/** Callout only: the line under the label. */
		detail?: string;
		/** Callout only: extra content (addresses, a key summary). */
		children?: Snippet;
		size?: 'sm' | 'md';
		/** Pulse once when it appears (use when the feature just fired). */
		flash?: boolean;
		class?: string;
	}

	let {
		feature,
		label,
		tip,
		description,
		href,
		variant = 'tag',
		detail,
		children,
		size = 'md',
		flash = false,
		class: className = ''
	}: Props = $props();

	const def = $derived(feature ? TEMPO_FEATURES[feature] : undefined);
	const text = $derived(label ?? def?.label ?? 'Tempo protocol');
	const tipRef = $derived(
		tip === null ? undefined : (tip ?? (def && 'tip' in def ? def.tip : undefined))
	);
	const title = $derived(def?.title ?? text);
	const body = $derived(description ?? def?.description ?? '');
	const link = $derived(href ?? (def && 'href' in def ? def.href : undefined));
</script>

{#snippet glyph(s: number)}
	<svg class="glyph" width={s} height={s} viewBox="0 0 12 12" aria-hidden="true">
		<path d="M6 .9 11.1 6 6 11.1.9 6Z" fill="none" stroke="currentColor" stroke-width="1.3" />
		<circle cx="6" cy="6" r="1.5" fill="currentColor" />
	</svg>
{/snippet}

{#snippet tooltipBody()}
	<div class="tt">
		<div class="tt-over">
			{@render glyph(11)}
			<span>Tempo protocol</span>
			{#if tipRef}<span class="tt-tip">{tipRef}</span>{/if}
		</div>
		<p class="tt-title">{title}</p>
		{#if body}<p class="tt-body">{body}</p>{/if}
		<p class="tt-note">{TEMPO_PROTOCOL_NOTE}</p>
		{#if link}
			<a class="tt-link" href={link} target="_blank" rel="noreferrer noopener">
				Read the Tempo docs <ArrowUpRight size={12} strokeWidth={2} aria-hidden="true" />
			</a>
		{/if}
	</div>
{/snippet}

{#if variant === 'callout'}
	<div class="callout {className}" class:flash>
		<div class="c-head">
			<span class="c-glyph">{@render glyph(12)}</span>
			<Tooltip content={tooltipBody} variant="rich" interactive placement="bottom">
				<button
					type="button"
					class="c-label"
					aria-label="{text}{tipRef ? `, ${tipRef}` : ''}. About this Tempo feature"
				>
					<span>{text}</span>
					{#if tipRef}<span class="tipref">{tipRef}</span>{/if}
				</button>
			</Tooltip>
		</div>
		{#if detail}<p class="c-detail">{detail}</p>{/if}
		{#if children}<div class="c-body">{@render children()}</div>{/if}
	</div>
{:else}
	<Tooltip content={tooltipBody} variant="rich" interactive>
		<button
			type="button"
			class="tag {size} {className}"
			class:flash
			aria-label="{text}{tipRef ? `, ${tipRef}` : ''}. About this Tempo feature"
		>
			{@render glyph(size === 'sm' ? 10 : 11)}
			<span class="t-label">{text}</span>
			{#if tipRef}<span class="tipref">{tipRef}</span>{/if}
		</button>
	</Tooltip>
{/if}

<style>
	/* ---------- inline tag ---------- */
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 100%;
		height: 1.5rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--tone-protocol-border);
		border-radius: var(--radius-sm);
		background: var(--tone-protocol-bg);
		color: var(--tone-protocol-fg);
		font-size: var(--text-xs);
		line-height: 1;
		font-weight: var(--weight-medium);
		letter-spacing: -0.002em;
		text-align: left;
		cursor: help;
		transition:
			border-color var(--duration-fast) var(--ease-standard),
			background-color var(--duration-fast) var(--ease-standard);
	}

	.tag.sm {
		height: 1.25rem;
		padding: 0 6px;
		gap: 5px;
		font-size: var(--text-2xs);
	}

	.tag:hover {
		border-color: var(--color-accent);
	}

	.tag:focus-visible,
	.c-label:focus-visible {
		outline: none;
		box-shadow: var(--color-focus-ring);
	}

	.t-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tipref {
		flex-shrink: 0;
		padding-left: 6px;
		border-left: 1px solid var(--tone-protocol-border);
		font-family: var(--font-mono);
		font-size: 0.92em;
		font-weight: 500;
		letter-spacing: 0;
		opacity: 0.85;
	}

	.glyph {
		flex-shrink: 0;
	}

	/* ---------- callout ---------- */
	.callout {
		display: flex;
		flex-direction: column;
		gap: var(--space-1-5);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--tone-protocol-border);
		border-radius: var(--radius-md);
		background: var(--tone-protocol-bg);
		color: var(--tone-protocol-fg);
	}

	.c-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.c-glyph {
		display: inline-flex;
	}

	.c-label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		color: var(--tone-protocol-fg);
		text-align: left;
		cursor: help;
		border-radius: var(--radius-xs);
		text-decoration: underline dotted;
		text-decoration-color: var(--tone-protocol-border);
		text-underline-offset: 3px;
	}

	.c-label .tipref {
		font-weight: 500;
		text-decoration: none;
	}

	.c-detail {
		padding-left: calc(12px + var(--space-2));
		font-size: var(--text-xs);
		line-height: var(--leading-xs);
		color: var(--color-text-secondary);
	}

	.c-body {
		padding-left: calc(12px + var(--space-2));
		color: var(--color-text);
	}

	/* ---------- flash ---------- */
	.flash {
		animation: flash 1.4s var(--ease-out) 1;
	}

	@keyframes flash {
		0% {
			box-shadow: 0 0 0 0 var(--color-accent-muted);
		}
		30% {
			box-shadow: 0 0 0 6px var(--color-accent-muted);
		}
		100% {
			box-shadow: 0 0 0 0 transparent;
		}
	}

	/* ---------- tooltip body ---------- */
	.tt {
		display: flex;
		flex-direction: column;
		gap: var(--space-1-5);
	}

	.tt-over {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--text-2xs);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--tone-protocol-fg);
	}

	.tt-tip {
		margin-left: auto;
		font-family: var(--font-mono);
		letter-spacing: 0;
		text-transform: none;
		font-weight: 500;
	}

	.tt-title {
		font-weight: var(--weight-semibold);
		color: var(--color-text);
	}

	.tt-body {
		color: var(--color-text-secondary);
	}

	.tt-note {
		margin-top: var(--space-1);
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border-subtle);
		font-size: var(--text-xs);
		line-height: var(--leading-xs);
		color: var(--color-text-tertiary);
	}

	.tt-link {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
	}
</style>
