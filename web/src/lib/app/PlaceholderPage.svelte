<script lang="ts">
	/**
	 * Temporary page body used by routes that are not built yet. Page agents replace the whole
	 * route file; do not ship this to a finished page.
	 */
	import Hammer from '@lucide/svelte/icons/hammer';
	import { Card, EmptyState, PageHeader, type Crumb, type IconComponent } from '#lib/ui';

	interface Props {
		title: string;
		subtitle?: string;
		breadcrumbs?: Crumb[];
		icon?: IconComponent;
		/** What will live here, in one sentence. */
		note?: string;
	}
	let { title, subtitle, breadcrumbs, icon = Hammer, note }: Props = $props();
</script>

<svelte:head><title>{title} · Portunus</title></svelte:head>

<PageHeader {title} {subtitle} {breadcrumbs} />
<Card padding="lg">
	<EmptyState {icon} title="Coming next" description={note ?? 'This page is being built.'} />
</Card>
