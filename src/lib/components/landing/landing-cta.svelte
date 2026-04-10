<script lang="ts">
	import { Button } from '$lib/components/ui/button';

	let { isAuthenticated = false } = $props<{ isAuthenticated?: boolean }>();
</script>

<section class="rounded-3xl border border-border/50 bg-linear-to-br from-sky-100/70 via-background to-amber-100/70 p-8 dark:from-sky-950/40 dark:to-amber-950/30 sm:p-10" data-reveal>
	<div class="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
		<div class="space-y-2">
			<p class="text-xs uppercase tracking-wide text-muted-foreground">No paywall</p>
			<h2 class="font-heading text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
				Start free now, cite with 5 styles, and collaborate as your project grows.
			</h2>
		</div>
		{#if isAuthenticated}
			<Button href="/dashboard" size="lg">Continue in dashboard</Button>
		{:else}
			<Button href="/auth" size="lg">Create free account</Button>
		{/if}
	</div>
</section>
