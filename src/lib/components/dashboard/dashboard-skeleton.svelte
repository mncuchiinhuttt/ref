<script lang="ts">
	import { Skeleton } from '$lib/components/ui/skeleton';
</script>

<div class="grid gap-4" aria-busy="true" aria-live="polite">
	<div class="rounded-2xl border border-border/50 bg-card/80 p-5">
		<Skeleton class="mb-3 h-6 w-48" />
		<Skeleton class="h-4 w-72 max-w-full" />
	</div>

	<div class="grid gap-4 md:grid-cols-3">
		{#each Array.from({ length: 3 }) as _, idx (idx)}
			<div class="rounded-2xl border border-border/50 bg-card/80 p-5" aria-label={`Loading stat ${idx + 1}`}>
				<Skeleton class="mb-4 h-3 w-24" />
				<Skeleton class="mb-3 h-7 w-20" />
				<Skeleton class="h-3 w-32" />
			</div>
		{/each}
	</div>

	<div class="rounded-2xl border border-border/50 bg-card/80 p-5">
		<Skeleton class="mb-4 h-5 w-44" />
		<div class="grid gap-3">
			{#each Array.from({ length: 4 }) as _, idx (idx)}
				<Skeleton class="h-12 w-full" aria-label={`Loading activity ${idx + 1}`} />
			{/each}
		</div>
	</div>
</div>
