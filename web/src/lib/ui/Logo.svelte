<script lang="ts">
	/**
	 * Portunus mark: a harbour gate (arch on a quay) with a keyhole cut through it.
	 * Portunus is the Roman god of keys and harbours; the product decides when a
	 * container may pass the gate. Never recolor outside the tokens, never add effects.
	 */
	interface Props {
		variant?: 'full' | 'mark' | 'wordmark';
		/** Mark height in px. Wordmark scales with it. */
		size?: number;
		/** 'brand' = accent mark + ink wordmark; 'mono' = currentColor; 'inverse' = for dark bands. */
		tone?: 'brand' | 'mono' | 'inverse';
		/** Accessible label; set to '' when a sibling already names the product. */
		label?: string;
		class?: string;
	}

	let {
		variant = 'full',
		size = 24,
		tone = 'brand',
		label = 'Portunus',
		class: className = ''
	}: Props = $props();
</script>

<span
	class="logo {tone} {variant} {className}"
	style:--size="{size}px"
	role={label ? 'img' : undefined}
	aria-label={label || undefined}
	aria-hidden={label ? undefined : 'true'}
>
	{#if variant !== 'wordmark'}
		<svg class="mark" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
			<path
				class="gate"
				fill-rule="evenodd"
				d="M4.75 19.25V10.5a7.25 7.25 0 0 1 14.5 0v8.75ZM12 8.4a2.45 2.45 0 0 0-1.17 4.6l-.53 4.15h3.4l-.53-4.15A2.45 2.45 0 0 0 12 8.4Z"
			/>
			<rect class="quay" x="2.5" y="20.5" width="19" height="1.6" rx="0.8" />
		</svg>
	{/if}
	{#if variant !== 'mark'}
		<span class="word">Portunus</span>
	{/if}
</span>

<style>
	.logo {
		display: inline-flex;
		align-items: center;
		gap: calc(var(--size) * 0.36);
		line-height: 1;
		color: var(--color-text);
	}

	.mark {
		display: block;
	}

	.brand .gate {
		fill: var(--color-accent);
	}

	.brand .quay {
		fill: var(--color-text);
	}

	.mono .gate,
	.mono .quay {
		fill: currentColor;
	}

	.inverse {
		color: var(--color-text-inverse);
	}

	.inverse .gate {
		fill: var(--color-text-inverse);
	}

	.inverse .quay {
		fill: var(--color-text-inverse);
		opacity: 0.55;
	}

	.word {
		font-family: var(--font-display);
		font-size: calc(var(--size) * 0.86);
		font-weight: 560;
		letter-spacing: -0.015em;
		font-variation-settings: 'opsz' 24;
		transform: translateY(-0.02em);
	}
</style>
