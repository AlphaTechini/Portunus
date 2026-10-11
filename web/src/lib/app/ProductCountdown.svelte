<script lang="ts">
	/**
	 * `<Countdown>` that follows the product clock (real time plus the demo clock offset), so
	 * "Free time ends in" and settlement windows jump when the demo clock moves. Same props as
	 * `<Countdown>` from `#lib/ui`; use this one on every page.
	 */
	import { onMount, type ComponentProps } from 'svelte';
	import { Countdown } from '#lib/ui';
	import { useApp } from './ctx.svelte';

	type Props = Omit<ComponentProps<typeof Countdown>, 'now' | 'onElapsed'> & {
		onElapsed?: () => void;
	};
	let { onElapsed, ...rest }: Props = $props();

	const app = useApp();
	let tick = $state(Date.now());
	let fired = false;
	const now = $derived(tick + app.clockOffsetMs);
	const end = $derived(new Date(rest.target).getTime());

	onMount(() => {
		const id = setInterval(() => (tick = Date.now()), 1000);
		return () => clearInterval(id);
	});

	$effect(() => {
		if (now >= end && !fired) {
			fired = true;
			onElapsed?.();
		}
		if (now < end) fired = false;
	});
</script>

<Countdown {...rest} {now} />
