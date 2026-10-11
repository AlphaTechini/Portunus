<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import type { TableColumn } from './types';
	import Skeleton from './Skeleton.svelte';
	import EmptyState from './EmptyState.svelte';
	import type { IconComponent } from './status';

	interface Props {
		columns: TableColumn[];
		rows: T[];
		/** Stable key per row. */
		rowKey: (row: T) => string;
		/** Custom cell rendering. Falls back to row[column.key] as text. */
		cell?: Snippet<[T, TableColumn]>;
		/** Accessible caption (visually hidden unless showCaption). */
		caption: string;
		showCaption?: boolean;
		/** Makes each row a link (stretched over the row). */
		rowHref?: (row: T) => string;
		/** Accessible text for the row link, e.g. the container number. */
		rowLabel?: (row: T) => string;
		loading?: boolean;
		loadingRows?: number;
		/** Empty state. Provide a snippet or title/description. */
		empty?: Snippet;
		emptyTitle?: string;
		emptyDescription?: string;
		emptyIcon?: IconComponent;
		density?: 'comfortable' | 'compact';
		stickyHeader?: boolean;
		/** Highlight a row (e.g. the one that just changed). */
		highlight?: (row: T) => boolean;
		/** Card chrome around the table. */
		framed?: boolean;
		class?: string;
	}

	let {
		columns,
		rows,
		rowKey,
		cell,
		caption,
		showCaption = false,
		rowHref,
		rowLabel,
		loading = false,
		loadingRows = 4,
		empty,
		emptyTitle = 'Nothing here yet',
		emptyDescription,
		emptyIcon,
		density = 'comfortable',
		stickyHeader = false,
		highlight,
		framed = true,
		class: className = ''
	}: Props = $props();

	function alignOf(c: TableColumn) {
		return c.align ?? (c.numeric ? 'right' : 'left');
	}

	function text(row: T, key: string): string {
		const v = (row as Record<string, unknown>)[key];
		return v === undefined || v === null ? '' : String(v);
	}
</script>

<div class="wrap {density} {className}" class:framed class:sticky={stickyHeader}>
	<div class="scroller">
		<table>
			<caption class:sr-only={!showCaption}>{caption}</caption>
			<colgroup>
				{#each columns as c (c.key)}<col style:width={c.width} />{/each}
			</colgroup>
			<thead>
				<tr>
					{#each columns as c (c.key)}
						<th
							scope="col"
							class="align-{alignOf(c)} {c.hideBelow ? `hide-${c.hideBelow}` : ''}"
							class:num={c.numeric}
						>
							{#if c.srOnlyLabel}<span class="sr-only">{c.label}</span>{:else}{c.label}{/if}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#if loading}
					{#each Array.from({ length: loadingRows }, (_, i) => i) as i (i)}
						<tr class="skeleton-row" aria-hidden="true">
							{#each columns as c (c.key)}
								<td class="align-{alignOf(c)} {c.hideBelow ? `hide-${c.hideBelow}` : ''}">
									<Skeleton width={c.numeric ? '4rem' : '70%'} />
								</td>
							{/each}
						</tr>
					{/each}
				{:else if rows.length === 0}
					<tr class="empty-row">
						<td colspan={columns.length}>
							{#if empty}{@render empty()}{:else}
								<EmptyState
									compact
									title={emptyTitle}
									description={emptyDescription}
									icon={emptyIcon}
								/>
							{/if}
						</td>
					</tr>
				{:else}
					{#each rows as row (rowKey(row))}
						<tr class:clickable={!!rowHref} class:hl={highlight?.(row)}>
							{#each columns as c, ci (c.key)}
								<td
									class="align-{alignOf(c)} {c.hideBelow ? `hide-${c.hideBelow}` : ''}"
									class:num={c.numeric}
								>
									{#if ci === 0 && rowHref}
										<a class="row-link" href={rowHref(row)}>
											<span class="sr-only">{rowLabel?.(row) ?? 'Open'}</span>
										</a>
									{/if}
									{#if cell}{@render cell(row, c)}{:else}{text(row, c.key)}{/if}
								</td>
							{/each}
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
	{#if loading}<span class="sr-only" role="status">Loading</span>{/if}
</div>

<style>
	.wrap {
		--row-h: 3rem;
		--cell-px: var(--space-4);
		min-width: 0;
	}

	.compact {
		--row-h: 2.5rem;
		--cell-px: var(--space-3);
	}

	.framed {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		overflow: hidden;
	}

	.scroller {
		position: relative; /* contains visually hidden header labels so they cannot widen the page */
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		font-size: var(--text-sm);
	}

	caption {
		padding: var(--space-3) var(--cell-px);
		text-align: left;
		font-weight: var(--weight-semibold);
	}

	th {
		height: 2.25rem;
		padding: 0 var(--cell-px);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface-sunken);
		color: var(--color-text-tertiary);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		white-space: nowrap;
		text-align: left;
	}

	.sticky th {
		position: sticky;
		top: 0;
		z-index: 1;
	}

	td {
		height: var(--row-h);
		padding: var(--space-2) var(--cell-px);
		border-bottom: 1px solid var(--color-border-subtle);
		color: var(--color-text);
		vertical-align: middle;
	}

	tbody tr:last-child td {
		border-bottom: 0;
	}

	.align-right {
		text-align: right;
	}

	.align-center {
		text-align: center;
	}

	.num {
		font-variant-numeric: tabular-nums;
		font-feature-settings: var(--font-features-numeric);
		white-space: nowrap;
	}

	tr.clickable {
		position: relative;
	}

	tr.clickable:hover td {
		background: var(--color-surface-hover);
	}

	.row-link {
		position: absolute;
		inset: 0;
		z-index: 0;
	}

	.row-link:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: -2px;
		border-radius: 0;
	}

	/* interactive content inside a linked row must sit above the stretched link */
	tr.clickable td :global(:is(button, a:not(.row-link), input, select)) {
		position: relative;
		z-index: 1;
	}

	tr.hl td {
		animation: hl 2.4s var(--ease-out) 1;
	}

	@keyframes hl {
		0%,
		30% {
			background: var(--color-accent-subtle);
		}
		100% {
			background: transparent;
		}
	}

	.empty-row td {
		height: auto;
		padding: 0;
	}

	@media (max-width: 1023px) {
		.hide-lg {
			display: none;
		}
	}

	@media (max-width: 767px) {
		.hide-md {
			display: none;
		}

		.wrap {
			--cell-px: var(--space-3);
		}
	}

	@media (max-width: 479px) {
		.hide-sm {
			display: none;
		}
	}
</style>
