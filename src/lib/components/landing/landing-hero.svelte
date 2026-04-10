<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';

	let { isAuthenticated = false } = $props<{ isAuthenticated?: boolean }>();
</script>

<section class="relative overflow-hidden rounded-3xl border border-border/40 bg-card/80 p-6 shadow-sm sm:p-10 lg:p-14" data-reveal>
	<div class="pointer-events-none absolute -top-20 left-1/2 size-80 -translate-x-1/2 rounded-full bg-linear-to-br from-amber-400/30 via-orange-300/15 to-transparent blur-3xl"></div>
	<div class="pointer-events-none absolute -bottom-24 right-0 size-72 rounded-full bg-linear-to-br from-cyan-400/20 to-transparent blur-3xl"></div>

	<div class="relative z-10 grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-end">
		<div class="space-y-5">
			<Badge variant="secondary" class="w-fit">Free for everyone</Badge>
			<h1 class="font-heading text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
				A free citation workspace for RMIT-ready references and team collaboration.
			</h1>
			<p class="max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg">
				Generate references with zero subscription cost, share projects so others can contribute, and use
				RMIT Harvard style with four other styles today. More styles are coming in upcoming updates.
			</p>
			<div class="flex flex-wrap items-center gap-3">
				{#if isAuthenticated}
					<Button href="/dashboard" size="lg">Open free workspace</Button>
				{:else}
					<Button href="/auth" size="lg">Start free</Button>
				{/if}
			</div>
		</div>

		<div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
			<div class="rounded-2xl border border-border/60 bg-background/80 p-4 backdrop-blur">
				<p class="text-xs uppercase tracking-wide text-muted-foreground">Price</p>
				<p class="font-heading mt-2 text-2xl font-semibold">$0</p>
				<p class="text-xs text-muted-foreground">No paid plan required</p>
			</div>
			<div class="rounded-2xl border border-border/60 bg-background/80 p-4 backdrop-blur">
				<p class="text-xs uppercase tracking-wide text-muted-foreground">Styles available now</p>
				<p class="font-heading mt-2 text-2xl font-semibold">5</p>
				<p class="text-xs text-muted-foreground">More styles coming soon</p>
			</div>
			<div class="rounded-2xl border border-border/60 bg-background/80 p-4 backdrop-blur">
				<p class="text-xs uppercase tracking-wide text-muted-foreground">Collaboration</p>
				<p class="font-heading mt-2 text-2xl font-semibold">Share & co-write</p>
				<p class="text-xs text-muted-foreground">Invite others to contribute</p>
			</div>
		</div>
	</div>
</section>
