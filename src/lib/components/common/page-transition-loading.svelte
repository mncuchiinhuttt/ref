<script lang="ts">
	import { Skeleton } from '$lib/components/ui/skeleton';

	const actionSkeletons = [0, 1, 2];
	const cardSkeletons = [0, 1, 2];
</script>

<div
	class="fixed inset-0 z-70 bg-background/86 backdrop-blur-[2px]"
	role="status"
	aria-live="polite"
	aria-label="Loading page"
>
	<div class="mx-auto flex h-full w-full max-w-7xl flex-col gap-6 px-4 py-4 sm:px-6 lg:px-8">
		<div class="space-y-4 pt-1">
			<Skeleton class="h-1 w-full rounded-full" />
			<div class="flex items-center justify-between gap-4">
				<div class="space-y-2">
					<Skeleton class="h-5 w-40" />
					<Skeleton class="h-3 w-28" />
				</div>
				<div class="hidden items-center gap-2 sm:flex">
					{#each actionSkeletons as action (action)}
						<Skeleton class="h-9 w-24 rounded-lg" />
					{/each}
				</div>
			</div>
		</div>

		<main class="flex-1 space-y-5 pt-2">
			<Skeleton class="h-10 w-64 max-w-full" />
			<Skeleton class="h-4 w-96 max-w-full" />

			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each cardSkeletons as card (card)}
					<div class="rounded-2xl border border-border/60 bg-card/70 p-4">
						<Skeleton class="mb-3 h-5 w-32" />
						<Skeleton class="mb-2 h-3 w-full" />
						<Skeleton class="mb-2 h-3 w-5/6" />
						<Skeleton class="h-3 w-2/3" />
					</div>
				{/each}
			</div>

			<div class="rounded-2xl border border-border/60 bg-card/70 p-4">
				<Skeleton class="mb-3 h-4 w-44" />
				<Skeleton class="mb-2 h-3 w-full" />
				<Skeleton class="mb-2 h-3 w-full" />
				<Skeleton class="h-3 w-11/12" />
			</div>
		</main>
	</div>
</div>
