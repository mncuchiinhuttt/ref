<script lang="ts">
	import SiteHeader from '$lib/components/common/site-header.svelte';
	import { Button } from '$lib/components/ui/button';

	let { error, status }: { error: App.Error; status: number } = $props();

	const isNotFound = $derived(status === 404);
	const title = $derived(isNotFound ? 'Page not found' : 'Something went wrong');
	const description = $derived(
		isNotFound
			? 'The page you requested does not exist or may have moved.'
			: (error?.message ?? 'An unexpected error occurred while loading this page.')
	);
</script>

<div class="min-h-dvh bg-linear-to-b from-background via-background to-muted/20">
	<SiteHeader subtitle="Error" showDashboardCta={false} />

	<main class="mx-auto flex w-full max-w-7xl flex-col px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
		<section class="mx-auto grid w-full max-w-2xl gap-4 rounded-2xl border border-border/60 bg-card/85 p-6 text-center shadow-sm sm:p-8">
			<p class="text-xs font-medium tracking-wider text-muted-foreground">STATUS {status}</p>
			<h1 class="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
			<p class="text-sm text-muted-foreground sm:text-base">{description}</p>
			<div class="flex flex-wrap items-center justify-center gap-2 pt-2">
				<Button href="/">Go home</Button>
				<Button href="/dashboard" variant="outline">Open dashboard</Button>
			</div>
		</section>
	</main>
</div>
