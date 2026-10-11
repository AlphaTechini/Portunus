/**
 * `/containers/[number]` gives a container number. `containers.byNumber` resolves it to the full
 * detail (same shape as `containers.get`) for the caller's own line or importer, or for the platform
 * resolver when the container has a dispute:
 *
 *   const ref = useContainerRef(() => page.params.number);
 *   ref.detail   // the detail, or undefined while loading / when it is not theirs
 *   ref.id       // container id, or null
 *   ref.loading  // true until the first answer arrives
 *   ref.found    // false once the answer is "not theirs"
 */
import { useAuthedQuery } from '#lib/backend';
import { api } from './api';

export function useContainerRef(number: () => string | undefined) {
	const wanted = $derived(
		decodeURIComponent(number() ?? '')
			.replace(/[\s-]/g, '')
			.toUpperCase()
	);
	const q = useAuthedQuery(api.containers.byNumber, () => (wanted ? { number: wanted } : 'skip'));
	return {
		get detail() {
			return q.data ?? undefined;
		},
		get id() {
			return q.data?.container._id ?? null;
		},
		get loading() {
			return q.isLoading && q.data === undefined;
		},
		get found() {
			return !!q.data;
		},
		get error() {
			return q.error;
		}
	};
}
