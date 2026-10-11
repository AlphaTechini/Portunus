/**
 * `/containers/[number]` gives a container number, but `containers.get` wants the id. This looks
 * the id up in the caller's own container list (line or importer), so detail pages can do:
 *
 *   const ref = useContainerRef(() => page.params.number);
 *   const detail = useAuthedQuery(api.containers.get, () => ref.id ? { containerId: ref.id } : 'skip');
 *
 * `ref.loading` is true while the list loads; `ref.id` is null when the number is not theirs.
 * (Backend gap: a `containers.byNumber` query would make this unnecessary.)
 */
import { useAuthedQuery } from '#lib/backend';
import { api } from './api';
import { useApp } from './ctx.svelte';

export function useContainerRef(number: () => string | undefined) {
	const app = useApp();
	const line = useAuthedQuery(api.containers.listForLine, () =>
		app.role === 'line' ? {} : 'skip'
	);
	const importer = useAuthedQuery(api.containers.listForImporter, () =>
		app.role === 'importer' ? {} : 'skip'
	);
	const rows = $derived(app.role === 'line' ? line.data : importer.data);
	const wanted = $derived(
		decodeURIComponent(number() ?? '')
			.replace(/[\s-]/g, '')
			.toUpperCase()
	);
	const match = $derived(
		rows?.find((c) => c.number.replace(/[\s-]/g, '').toUpperCase() === wanted)
	);
	return {
		get id() {
			return match?._id ?? null;
		},
		get loading() {
			return app.role !== 'platform' && rows === undefined;
		},
		get found() {
			return !!match;
		}
	};
}
