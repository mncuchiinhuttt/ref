<script lang="ts">
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import './layout.css';
	import refLogo from '$lib/assets/refLogo.png';
	import PageTransitionLoading from '$lib/components/common/page-transition-loading.svelte';
	import SiteFooter from '$lib/components/common/site-footer.svelte';
	import { Toaster } from '$lib/components/ui/sonner';

	let { children } = $props();
	let isRouteLoading = $state(false);

	beforeNavigate((navigation) => {
		if (!navigation.to || navigation.willUnload) {
			return;
		}

		const from = navigation.from?.url;
		const to = navigation.to.url;
		const isSameLocation = Boolean(
			from && to.pathname === from.pathname && to.search === from.search
		);
		if (isSameLocation) {
			return;
		}

		isRouteLoading = true;
	});

	afterNavigate(() => {
		isRouteLoading = false;
	});
</script>

<svelte:head>
	<link rel="icon" href={refLogo} />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>Ref@mncuchiinhuttt - Free Reference Tool</title>
</svelte:head>
{@render children()}
<SiteFooter />
<Toaster theme="system" position="top-right" richColors closeButton />
{#if isRouteLoading}
	<PageTransitionLoading />
{/if}
