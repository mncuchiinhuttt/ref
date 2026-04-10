<script lang="ts">
	import LandingPage from '$lib/components/pages/landing-page.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<LandingPage isAuthenticated={Boolean(data.user)} />
