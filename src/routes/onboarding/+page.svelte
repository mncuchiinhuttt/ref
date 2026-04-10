<script lang="ts">
	import OnboardingPage from '$lib/components/pages/onboarding-page.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();
</script>

<OnboardingPage {data} form={form ?? undefined} />
