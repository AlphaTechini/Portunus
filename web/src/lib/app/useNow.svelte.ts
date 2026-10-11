/**
 * A reactive product clock for live numbers (detention meters, "pulled today", eligibility).
 *
 *   const clock = useProductNow();
 *   const days = $derived(detentionDaysAt(c, clock.value));
 *
 * Ticks once a second and follows the demo clock offset. Call during component initialisation.
 */
import { onMount } from 'svelte';
import { useApp } from './ctx.svelte';

export function useProductNow(intervalMs = 1000) {
	const app = useApp();
	let tick = $state(Date.now());
	onMount(() => {
		const id = setInterval(() => (tick = Date.now()), intervalMs);
		return () => clearInterval(id);
	});
	return {
		/** Product "now" in ms. */
		get value() {
			return tick + app.clockOffsetMs;
		}
	};
}
