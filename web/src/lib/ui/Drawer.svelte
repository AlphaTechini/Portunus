<script lang="ts">
	import type { Snippet } from 'svelte';
	import Modal from './Modal.svelte';

	interface Props {
		open?: boolean;
		title: string;
		description?: string;
		size?: 'sm' | 'md' | 'lg';
		dismissible?: boolean;
		footer?: Snippet;
		onclose?: () => void;
		class?: string;
		children?: Snippet;
	}

	let { open = $bindable(false), ...rest }: Props = $props();
</script>

<Modal bind:open kind="drawer" {...rest} />
