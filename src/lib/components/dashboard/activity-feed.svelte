<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Separator } from '$lib/components/ui/separator';

	export type DashboardActivity = {
		title: string;
		note: string;
		timestamp: string;
	};

	let { activities }: { activities: DashboardActivity[] } = $props();
</script>

<Card class="border-border/60 bg-card/80" data-dashboard-reveal>
	<CardHeader>
		<CardTitle class="font-heading text-xl">Recent activity</CardTitle>
	</CardHeader>
	<CardContent class="grid gap-4">
		{#each activities as activity, index (`${activity.title}-${activity.timestamp}-${index}`)}
			<div class="grid gap-1">
				<div class="flex items-start justify-between gap-3">
					<p class="font-medium">{activity.title}</p>
					<span class="text-xs text-muted-foreground">{activity.timestamp}</span>
				</div>
				<p class="text-sm text-muted-foreground">{activity.note}</p>
			</div>
			{#if index < activities.length - 1}
				<Separator />
			{/if}
		{/each}
	</CardContent>
</Card>
