<script lang="ts">
	import './layout.css';
	import refLogo from '$lib/assets/refLogo.png';
	import SiteFooter from '$lib/components/common/site-footer.svelte';
	import { Toaster } from '$lib/components/ui/sonner';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={refLogo} />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>Ref@mncuchiinhuttt - Free Reference Tool</title>
</svelte:head>
{@render children()}
<SiteFooter />
<Toaster theme="system" position="top-right" richColors closeButton />
