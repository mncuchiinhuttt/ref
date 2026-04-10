<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

	export type DashboardStat = {
		label: string;
		value: string;
		hint: string;
	};

	let { stats }: { stats: DashboardStat[] } = $props();
</script>

<section class="grid gap-4 md:grid-cols-3">
	{#each stats as stat (stat.label)}
		<Card class="border-border/60 bg-card/80" data-dashboard-reveal>
			<CardHeader class="pb-2">
				<CardTitle class="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
			</CardHeader>
			<CardContent>
				<p class="font-heading text-3xl font-semibold tracking-tight">{stat.value}</p>
				<p class="mt-2 text-xs text-muted-foreground">{stat.hint}</p>
			</CardContent>
		</Card>
	{/each}
</section>
