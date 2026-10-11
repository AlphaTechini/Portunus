<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import type { Crumb } from './types';

	interface Props {
		title: string;
		/** Custom title rendering (e.g. a ContainerNumber). Keep `title` for the document. */
		titleSnippet?: Snippet;
		subtitle?: string;
		breadcrumbs?: Crumb[];
		/** Row under the title: StatusPill, TempoTags, key facts. */
		meta?: Snippet;
		/** Right side: primary and secondary actions. */
		actions?: Snippet;
		/** Bottom hairline (use when tabs or a table follow directly). */
		divider?: boolean;
		class?: string;
	}

	let {
		title,
		titleSnippet,
		subtitle,
		breadcrumbs,
		meta,
		actions,
		divider = false,
		class: className = ''
	}: Props = $props();
</script>

<header class="ph {className}" class:divider>
	{#if breadcrumbs?.length}
		<nav aria-label="Breadcrumb" class="crumbs">
			<ol>
				{#each breadcrumbs as c, i (i)}
					<li>
						{#if c.href && i < breadcrumbs.length - 1}
							<a href={c.href}>{c.label}</a>
						{:else}
							<span aria-current={i === breadcrumbs.length - 1 ? 'page' : undefined}>{c.label}</span
							>
						{/if}
						{#if i < breadcrumbs.length - 1}
							<ChevronRight size={12} strokeWidth={2} aria-hidden="true" />
						{/if}
					</li>
				{/each}
			</ol>
		</nav>
	{/if}
	<div class="main">
		<div class="titles">
			<h1 class="title">
				{#if titleSnippet}{@render titleSnippet()}<span class="sr-only">{title}</span
					>{:else}{title}{/if}
			</h1>
			{#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
		</div>
		{#if actions}<div class="actions">{@render actions()}</div>{/if}
	</div>
	{#if meta}<div class="meta">{@render meta()}</div>{/if}
</header>

<style>
	.ph {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-bottom: var(--space-6);
	}

	.divider {
		border-bottom: 1px solid var(--color-border);
		margin-bottom: var(--space-6);
	}

	.crumbs ol {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.crumbs li {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}

	.crumbs a {
		color: var(--color-text-secondary);
	}

	.crumbs a:hover {
		color: var(--color-text);
		text-decoration: none;
	}

	.crumbs [aria-current] {
		color: var(--color-text-tertiary);
	}

	.main {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.titles {
		display: flex;
		flex-direction: column;
		gap: var(--space-1-5);
		min-width: 0;
		flex: 1 1 22rem;
	}

	.title {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-2xl);
		line-height: var(--leading-2xl);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tight);
	}

	.subtitle {
		max-width: 44rem;
		font-size: var(--text-base);
		line-height: var(--leading-base);
		color: var(--color-text-secondary);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
</style>
