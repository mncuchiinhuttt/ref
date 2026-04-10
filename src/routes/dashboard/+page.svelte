<script lang="ts">
	import DashboardPage from '$lib/components/pages/dashboard-page.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();
</script>

<DashboardPage {data} form={form ?? undefined} />
