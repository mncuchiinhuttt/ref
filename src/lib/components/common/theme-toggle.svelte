<script lang="ts">
	import { MoonStar, SunMedium } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { applyTheme, getInitialTheme, toggleTheme, type Theme } from '$lib/theme';

	let theme = $state<Theme>('light');

	onMount(() => {
		theme = getInitialTheme();
		applyTheme(theme);
	});

	const handleToggle = () => {
		theme = toggleTheme(theme);
	};
</script>

<Button
	variant="outline"
	size="icon-sm"
	class="rounded-full"
	type="button"
	aria-label="Toggle color theme"
	onclick={handleToggle}
>
	{#if theme === 'dark'}
		<SunMedium data-icon="inline-start" />
	{:else}
		<MoonStar data-icon="inline-start" />
	{/if}
</Button>
