<script lang="ts">
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Sparkles, ShieldCheck, LayoutDashboard, FileSearch } from '@lucide/svelte';

	const features = [
		{
			title: 'Free by default',
			description:
				'Create and manage citation projects at no cost. This tool is built to stay accessible for students.',
			icon: ShieldCheck
		},
		{
			title: '5 citation styles today',
			description:
				'Use five styles now, including RMIT Harvard, with more style options planned in future updates.',
			icon: Sparkles
		},
		{
			title: 'Share and contribute together',
			description:
				'Invite classmates or teammates into the same project so everyone can add, edit, and refine citations.',
			icon: LayoutDashboard
		},
		{
			title: 'Designed for RMIT needs',
			description:
				'RMIT Harvard output is a first-class option, making this especially practical for RMIT coursework.',
			icon: FileSearch
		}
	];
</script>

<section class="grid gap-4 md:grid-cols-2" data-reveal>
	{#each features as feature (feature.title)}
		<Card class="border-border/60 bg-card/70 backdrop-blur-sm">
			<CardHeader class="gap-3">
				<div class="flex size-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
					<feature.icon data-icon="inline-start" />
				</div>
				<CardTitle class="font-heading text-xl">{feature.title}</CardTitle>
			</CardHeader>
			<CardContent>
				<CardDescription>{feature.description}</CardDescription>
			</CardContent>
		</Card>
	{/each}
</section>
