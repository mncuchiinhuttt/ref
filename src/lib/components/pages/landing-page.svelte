<script lang="ts">
	import { onMount } from 'svelte';
	import SiteHeader from '$lib/components/common/site-header.svelte';
	import LandingHero from '$lib/components/landing/landing-hero.svelte';
	import LandingFeatureGrid from '$lib/components/landing/landing-feature-grid.svelte';
	import LandingCta from '$lib/components/landing/landing-cta.svelte';

	let { isAuthenticated = false } = $props<{ isAuthenticated?: boolean }>();

	onMount(() => {
		let controls: Array<{ stop: () => void }> = [];
		let cancelled = false;

		void import('motion/mini')
			.then(({ animate }) => {
				if (cancelled) {
					return;
				}

				const revealItems = Array.from(document.querySelectorAll<HTMLElement>('#landing-page [data-reveal]'));

				controls = revealItems.map((item, index) =>
					animate(
						item,
						{ opacity: [0, 1], transform: ['translateY(20px)', 'translateY(0px)'] },
						{ duration: 0.6, delay: index * 0.08, ease: 'easeOut' }
					)
				);
			})
			.catch(() => undefined);

		return () => {
			cancelled = true;
			controls.forEach((control) => control.stop());
		};
	});
</script>

<div id="landing-page" class="min-h-dvh bg-linear-to-b from-background via-background to-muted/30">
	<SiteHeader
		showAuthCta={!isAuthenticated}
		showDashboardCta={isAuthenticated}
		showSignOutCta={isAuthenticated}
		signOutAction="?/signOut"
	/>
	<main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
		<LandingHero {isAuthenticated} />
		<LandingFeatureGrid />
		<LandingCta {isAuthenticated} />
	</main>
</div>
