<script lang="ts">
	/**
	 * Full-page skeleton in the shape of the app shell, shown while the backend starts and the
	 * session resolves. It fades in after a short delay so a fast load never flashes it.
	 */
	import { Logo, Skeleton } from '#lib/ui';

	interface Props {
		/** Screen reader text. */
		label?: string;
	}
	let { label = 'Loading Portunus' }: Props = $props();
</script>

<div class="frame" role="status" aria-label={label} aria-busy="true">
	<aside class="side">
		<div class="brand"><Logo size={22} label="" /></div>
		<div class="nav">
			{#each [0, 1, 2] as i (i)}<Skeleton height="2rem" radius="var(--radius-md)" />{/each}
			<div class="gap"></div>
			{#each [0, 1, 2] as i (i)}<Skeleton height="2rem" radius="var(--radius-md)" />{/each}
		</div>
	</aside>
	<div class="col">
		<div class="top">
			<div class="who">
				<Skeleton width="1.75rem" height="1.75rem" radius="var(--radius-sm)" />
				<Skeleton width="9rem" />
			</div>
			<Skeleton width="7rem" />
		</div>
		<div class="content">
			<div class="title">
				<Skeleton width="14rem" height="1.75rem" />
				<Skeleton width="22rem" />
			</div>
			<div class="kpis">
				{#each [0, 1, 2, 3] as i (i)}<Skeleton height="6.5rem" radius="var(--radius-lg)" />{/each}
			</div>
			<Skeleton height="16rem" radius="var(--radius-lg)" />
		</div>
	</div>
	<span class="sr-only">{label}</span>
</div>

<style>
	.frame {
		display: grid;
		grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
		min-height: 100dvh;
		background: var(--color-bg);
		opacity: 0;
		animation: appear var(--duration-slow) var(--ease-out) 160ms forwards;
	}

	@keyframes appear {
		to {
			opacity: 1;
		}
	}

	.side {
		border-right: 1px solid var(--color-border);
	}

	.brand {
		display: flex;
		align-items: center;
		height: var(--topbar-height);
		padding: 0 var(--space-5);
	}

	.nav {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3);
	}

	.gap {
		height: var(--space-5);
	}

	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: var(--topbar-height);
		padding: 0 var(--space-6);
		border-bottom: 1px solid var(--color-border);
	}

	.who {
		display: flex;
		align-items: center;
		gap: var(--space-2-5);
	}

	.content {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		max-width: var(--content-max);
		padding: var(--space-8);
	}

	.title {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.kpis {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-4);
	}

	@media (max-width: 1100px) {
		.kpis {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 1023px) {
		.frame {
			grid-template-columns: var(--sidebar-rail-width) minmax(0, 1fr);
		}

		.nav :global(.skeleton) {
			width: 2.5rem;
		}
	}

	@media (max-width: 767px) {
		.frame {
			grid-template-columns: minmax(0, 1fr);
		}

		.side {
			display: none;
		}

		.top,
		.content {
			padding-inline: var(--space-4);
		}

		.kpis {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
