<script lang="ts">
	import FilePlus from '@lucide/svelte/icons/file-plus';
	import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import DoorOpen from '@lucide/svelte/icons/door-open';
	import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
	import Ban from '@lucide/svelte/icons/ban';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Receipt from '@lucide/svelte/icons/receipt';
	import Scale from '@lucide/svelte/icons/scale';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import LockKeyhole from '@lucide/svelte/icons/lock-keyhole';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Flag from '@lucide/svelte/icons/flag';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import type { TimelineEntry, TimelineKind } from './types';
	import type { IconComponent, Tone } from './status';
	import { formatDate, formatFinality, formatTimestamp, isoString } from './format';
	import Hash from './Hash.svelte';
	import Money from './Money.svelte';
	import Spinner from './Spinner.svelte';

	interface Props {
		entries: TimelineEntry[];
		/** Newest first (default) or oldest first. */
		order?: 'newest' | 'oldest';
		/** Accessible name. */
		label?: string;
		/** Hide memo blocks (compact lists). */
		hideMemos?: boolean;
		/** Animate entries that arrive after mount. */
		animateNew?: boolean;
		class?: string;
	}

	let {
		entries,
		order = 'newest',
		label = 'Memo trail',
		hideMemos = false,
		animateNew = true,
		class: className = ''
	}: Props = $props();

	const KINDS: Record<TimelineKind, { icon: IconComponent; tone: Tone }> = {
		request: { icon: FilePlus, tone: 'neutral' },
		deposit: { icon: ArrowDownToLine, tone: 'protocol' },
		authorization: { icon: KeyRound, tone: 'protocol' },
		release: { icon: DoorOpen, tone: 'info' },
		pull: { icon: ArrowRightLeft, tone: 'caution' },
		refused: { icon: Ban, tone: 'danger' },
		return: { icon: PackageCheck, tone: 'info' },
		charge: { icon: Receipt, tone: 'caution' },
		settlement: { icon: Scale, tone: 'protocol' },
		refund: { icon: Undo2, tone: 'success' },
		revocation: { icon: LockKeyhole, tone: 'neutral' },
		held: { icon: ShieldAlert, tone: 'warning' },
		dispute: { icon: Flag, tone: 'danger' },
		note: { icon: MessageSquare, tone: 'neutral' }
	};

	const sorted = $derived(
		[...entries].sort((a, b) => {
			const d = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
			return order === 'newest' ? -d : d;
		})
	);

	// Entries present at mount do not animate; later arrivals slide in.
	let seen: Set<string> | null = null;
	$effect(() => {
		if (!seen) seen = new Set(entries.map((e) => e.id));
	});
	const isNew = (id: string) => animateNew && seen !== null && !seen.has(id);
</script>

<ol class="tl {className}" aria-label={label}>
	{#each sorted as e (e.id)}
		{@const k = KINDS[e.kind] ?? KINDS.note}
		{@const status = e.status ?? 'confirmed'}
		<li
			class="entry tone-{status === 'failed' ? 'danger' : k.tone} status-{status}"
			class:enter={isNew(e.id)}
		>
			<div class="rail" aria-hidden="true">
				<span class="node">
					{#if status === 'pending'}
						<Spinner size={12} />
					{:else}
						<k.icon size={12} strokeWidth={2} />
					{/if}
				</span>
			</div>
			<div class="body">
				<div class="row">
					<div class="titles">
						<p class="title">
							{e.title}
							{#if status === 'pending'}<span class="pending">Pending on-chain</span>{/if}
							{#if status === 'failed'}<span class="failed">Refused by the chain</span>{/if}
						</p>
						{#if e.actor || e.detail}
							<p class="sub">
								{#if e.actor}<span>{e.actor}</span>{/if}
								{#if e.actor && e.detail}<span aria-hidden="true"> · </span>{/if}
								{#if e.detail}<span>{e.detail}</span>{/if}
							</p>
						{/if}
					</div>
					{#if e.amount !== undefined}
						<Money
							amount={e.amount}
							class="amt"
							tone={e.kind === 'refund' ? 'positive' : status === 'failed' ? 'muted' : 'default'}
						/>
					{/if}
				</div>
				{#if e.memo && !hideMemos}
					<div class="memo">
						<span class="memo-k">Memo</span>
						<code>{e.memo}</code>
					</div>
				{/if}
				<div class="meta">
					<time datetime={isoString(e.timestamp)} class="tabular" title={isoString(e.timestamp)}>
						{formatDate(e.timestamp)}, {formatTimestamp(e.timestamp)}
					</time>
					{#if e.finalityMs !== undefined && status === 'confirmed'}
						<span class="final tabular">Final in {formatFinality(e.finalityMs)}</span>
					{/if}
					{#if e.txHash}<Hash value={e.txHash} kind="tx" href={e.href} size="sm" />{/if}
				</div>
			</div>
		</li>
	{/each}
</ol>

<style>
	.tl {
		display: flex;
		flex-direction: column;
	}

	.entry {
		--solid: var(--tone-neutral-solid);
		--fg: var(--tone-neutral-fg);
		--bg: var(--tone-neutral-bg);
		--bd: var(--tone-neutral-border);
		display: grid;
		grid-template-columns: 1.5rem 1fr;
		gap: var(--space-3);
	}

	.enter {
		animation: enter var(--duration-slow) var(--ease-out);
	}

	.tone-protocol {
		--fg: var(--tone-protocol-fg);
		--bg: var(--tone-protocol-bg);
		--bd: var(--tone-protocol-border);
	}

	.tone-info {
		--fg: var(--tone-info-fg);
		--bg: var(--tone-info-bg);
		--bd: var(--tone-info-border);
	}

	.tone-success {
		--fg: var(--tone-success-fg);
		--bg: var(--tone-success-bg);
		--bd: var(--tone-success-border);
	}

	.tone-warning {
		--fg: var(--tone-warning-fg);
		--bg: var(--tone-warning-bg);
		--bd: var(--tone-warning-border);
	}

	.tone-caution {
		--fg: var(--tone-caution-fg);
		--bg: var(--tone-caution-bg);
		--bd: var(--tone-caution-border);
	}

	.tone-danger {
		--fg: var(--tone-danger-fg);
		--bg: var(--tone-danger-bg);
		--bd: var(--tone-danger-border);
	}

	.rail {
		position: relative;
		display: flex;
		justify-content: center;
	}

	.rail::after {
		content: '';
		position: absolute;
		top: 1.75rem;
		bottom: 0;
		left: 50%;
		width: 1px;
		background: var(--color-border);
	}

	.entry:last-child .rail::after {
		display: none;
	}

	.node {
		position: relative;
		z-index: 1;
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		border: 1px solid var(--bd);
		border-radius: 50%;
		background: var(--bg);
		color: var(--fg);
		box-shadow: 0 0 0 3px var(--color-surface);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		padding-bottom: var(--space-6);
	}

	.entry:last-child .body {
		padding-bottom: 0;
	}

	.row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		min-height: 1.5rem;
	}

	.titles {
		min-width: 0;
		padding-top: 2px;
	}

	.title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		font-weight: var(--weight-medium);
		color: var(--color-text);
	}

	.pending,
	.failed {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
	}

	.pending {
		color: var(--color-text-tertiary);
	}

	.failed {
		color: var(--tone-danger-fg);
	}

	.sub {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}

	.body :global(.amt) {
		padding-top: 2px;
		font-weight: var(--weight-semibold);
	}

	.status-failed .body :global(.amt) {
		text-decoration: line-through;
	}

	.memo {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-sm);
		background: var(--color-surface-sunken);
		min-width: 0;
	}

	.memo-k {
		flex-shrink: 0;
		font-size: var(--text-2xs);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-caps);
		text-transform: uppercase;
		color: var(--color-text-tertiary);
	}

	.memo code {
		font-size: 0.75rem;
		color: var(--color-text);
		overflow-wrap: anywhere;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-3);
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.final {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--tone-protocol-fg);
		font-weight: var(--weight-medium);
	}

	.final::before {
		content: '';
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--tone-protocol-solid);
	}

	@keyframes enter {
		from {
			opacity: 0;
			transform: translateY(-6px);
		}
	}
</style>
