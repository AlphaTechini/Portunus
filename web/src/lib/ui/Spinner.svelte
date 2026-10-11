<script lang="ts">
	interface Props {
		size?: number;
		label?: string;
		class?: string;
	}
	let { size = 16, label, class: className = '' }: Props = $props();
</script>

<svg
	class="spinner {className}"
	width={size}
	height={size}
	viewBox="0 0 16 16"
	fill="none"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
>
	<circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-opacity="0.22" stroke-width="1.5" />
	<path
		d="M14.25 8A6.25 6.25 0 0 0 8 1.75"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
	/>
</svg>

<style>
	.spinner {
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 1.6s !important;
			animation-iteration-count: infinite !important;
		}
	}
</style>
