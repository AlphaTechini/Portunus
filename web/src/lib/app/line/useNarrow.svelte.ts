import { onMount } from 'svelte';

/** True while the viewport is narrower than `maxWidth` px. Call during component initialisation. */
export function useNarrow(maxWidth = 767) {
	let narrow = $state(false);
	onMount(() => {
		const mq = matchMedia(`(max-width: ${maxWidth}px)`);
		const sync = () => (narrow = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});
	return {
		get value() {
			return narrow;
		}
	};
}
