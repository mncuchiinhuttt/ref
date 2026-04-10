<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { tick } from 'svelte';
	import {
		BookOpen,
		Briefcase,
		Building2,
		CircleHelp,
		FlaskConical,
		Globe,
		GraduationCap,
		Library,
		Megaphone,
		Mic,
		Microscope,
		Presentation,
		Search,
		Share2,
		Sparkles,
		Users
	} from '@lucide/svelte';
	import SiteHeader from '$lib/components/common/site-header.svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		ACADEMIC_ROLE_OPTIONS,
		DISCOVERY_SOURCE_OPTIONS,
		RMIT_AFFILIATION_OPTIONS
	} from '$lib/constants/onboarding';
	import { cn } from '$lib/utils';
	import { fade, fly } from 'svelte/transition';

	type OnboardingData = {
		debug: boolean;
		prefill: {
			academicRole: string;
			discoverySource: string;
			isFromRmit: boolean | null;
		};
	};

	type OnboardingFormState = {
		success?: boolean;
		message?: string;
		academicRole?: string;
		rmitAffiliation?: string;
		discoverySource?: string;
	};

	let { data, form }: { data: OnboardingData; form?: OnboardingFormState } = $props();

	let step = $state(0);
	let academicRoleChoice = $state<string | null>(null);
	let rmitAffiliationChoice = $state<string | null>(null);
	let discoverySourceChoice = $state<string | null>(null);
	let isTransitioning = $state(false);
	let surveyCompleted = $state(false);

	const QUESTION_COUNT = 3;
	const STEP_TRANSITION_PAUSE_MS = 1_000;
	type IconComponent = typeof CircleHelp;

	const ROLE_ICON_MAP: Record<string, IconComponent> = {
		teacher: Presentation,
		'undergraduate-student': GraduationCap,
		'postgraduate-student': BookOpen,
		'post-doctoral-researcher': Microscope,
		lecturer: Presentation,
		'research-assistant': FlaskConical,
		librarian: Library,
		'industry-professional': Briefcase,
		other: Sparkles
	};

	const RMIT_ICON_MAP: Record<string, IconComponent> = {
		yes: Building2,
		no: Globe
	};

	const DISCOVERY_ICON_MAP: Record<string, IconComponent> = {
		'friend-classmate': Users,
		'teacher-lecturer': GraduationCap,
		'rmit-portal': Share2,
		'social-media': Megaphone,
		'search-engine': Search,
		'research-paper': Briefcase,
		'workshop-event': Mic,
		other: Sparkles
	};

	const academicRole = $derived(academicRoleChoice ?? form?.academicRole ?? data.prefill.academicRole ?? '');
	const rmitAffiliation = $derived(
		rmitAffiliationChoice ??
			form?.rmitAffiliation ??
			(data.prefill.isFromRmit === true ? 'yes' : data.prefill.isFromRmit === false ? 'no' : '')
	);
	const discoverySource = $derived(
		discoverySourceChoice ?? form?.discoverySource ?? data.prefill.discoverySource ?? ''
	);

	const activeStep = $derived(surveyCompleted || form?.success ? QUESTION_COUNT : step);

	const handleEnhance: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success') {
				surveyCompleted = true;
				await update({ reset: false, invalidateAll: false });
				return;
			}

			await update({ reset: false });
		};
	};

	const resolveIcon = (iconMap: Record<string, IconComponent>, value: string): IconComponent =>
		iconMap[value] ?? CircleHelp;

	const pauseBeforeTransition = (): Promise<void> =>
		new Promise((resolve) => {
			setTimeout(resolve, STEP_TRANSITION_PAUSE_MS);
		});

	const selectAcademicRole = async (value: string): Promise<void> => {
		if (form?.success || isTransitioning || activeStep !== 0) {
			return;
		}

		academicRoleChoice = value;
		isTransitioning = true;
		await pauseBeforeTransition();
		step = 1;
		isTransitioning = false;
	};

	const selectRmitAffiliation = async (value: string): Promise<void> => {
		if (form?.success || isTransitioning || activeStep !== 1) {
			return;
		}

		rmitAffiliationChoice = value;
		isTransitioning = true;
		await pauseBeforeTransition();
		step = 2;
		isTransitioning = false;
	};

	const selectDiscoverySource = async (value: string, formEl: HTMLFormElement | null): Promise<void> => {
		if (form?.success || isTransitioning || activeStep !== 2) {
			return;
		}

		discoverySourceChoice = value;
		isTransitioning = true;
		await pauseBeforeTransition();
		await tick();
		formEl?.requestSubmit();
		isTransitioning = false;
	};

	const optionButtonClass = (selected: boolean): string =>
		cn(
			'group flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-2xl border px-4 py-4 text-center transition-all duration-250',
			selected
				? 'border-primary/70 bg-primary/15 shadow-md ring-1 ring-primary/40'
				: 'border-border/50 bg-background/55 hover:border-primary/50 hover:bg-background/75',
			isTransitioning && 'cursor-wait opacity-85'
		);
</script>

<div class="relative min-h-dvh overflow-hidden bg-linear-to-b from-background via-background to-muted/30">
	<div class="pointer-events-none absolute -top-24 left-1/2 size-96 -translate-x-1/2 rounded-full bg-linear-to-br from-amber-400/30 via-orange-300/10 to-transparent blur-3xl"></div>
	<div class="pointer-events-none absolute -bottom-24 right-0 size-80 rounded-full bg-linear-to-br from-cyan-400/25 to-transparent blur-3xl"></div>

	<SiteHeader
		title="ref@mncuchiinhuttt"
		subtitle="First login setup"
		showAuthCta={false}
		showDashboardCta={false}
		showSignOutCta={true}
		signOutAction="?/signOut"
	/>

	<main class="relative z-10 mx-auto flex min-h-[calc(100dvh-68px)] w-full max-w-6xl items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
		<form
			method="POST"
			action="?/completeSurvey"
			use:enhance={handleEnhance}
			class="w-full max-w-4xl"
		>
			<input type="hidden" name="academicRole" value={academicRole} />
			<input type="hidden" name="rmitAffiliation" value={rmitAffiliation} />
			<input type="hidden" name="discoverySource" value={discoverySource} />

			<section class="rounded-3xl border border-border/50 bg-card/65 p-6 shadow-xl backdrop-blur-xl sm:p-8">
				<div class="space-y-6">
					{#key activeStep}
						<section in:fly={{ y: 14, duration: 420 }} out:fade={{ duration: 260 }} class="space-y-6">
							{#if activeStep === 0}
								<div class="space-y-2 text-center">
									<h1 class="font-heading text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
										What best describes your role?
									</h1>
									<p class="text-muted-foreground">Choose the option that fits you the best.</p>
								</div>
								<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
									{#each ACADEMIC_ROLE_OPTIONS as option (option.value)}
										{@const Icon = resolveIcon(ROLE_ICON_MAP, option.value)}
										<button
											type="button"
											class={optionButtonClass(academicRole === option.value)}
											onclick={() => {
												void selectAcademicRole(option.value);
											}}
											disabled={isTransitioning}
											aria-pressed={academicRole === option.value}
										>
											<Icon class="size-5 text-foreground/90" aria-hidden="true" />
											<span class="font-medium">{option.label}</span>
										</button>
									{/each}
								</div>
							{/if}

							{#if activeStep === 1}
								<div class="space-y-2 text-center">
									<h1 class="font-heading text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
										Are you from RMIT University?
									</h1>
									<p class="text-muted-foreground">This helps us tailor your first experience.</p>
								</div>
								<div class="mx-auto grid max-w-xl gap-3 sm:grid-cols-2">
									{#each RMIT_AFFILIATION_OPTIONS as option (option.value)}
										{@const Icon = resolveIcon(RMIT_ICON_MAP, option.value)}
										<button
											type="button"
											class={optionButtonClass(rmitAffiliation === option.value)}
											onclick={() => {
												void selectRmitAffiliation(option.value);
											}}
											disabled={isTransitioning}
											aria-pressed={rmitAffiliation === option.value}
										>
											<Icon class="size-5 text-foreground/90" aria-hidden="true" />
											<span class="font-medium">{option.label}</span>
										</button>
									{/each}
								</div>
							{/if}

							{#if activeStep === 2}
								<div class="space-y-2 text-center">
									<h1 class="font-heading text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
										How did you hear about this website?
									</h1>
									<p class="text-muted-foreground">Your answer helps us improve outreach.</p>
								</div>
								<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
									{#each DISCOVERY_SOURCE_OPTIONS as option (option.value)}
										{@const Icon = resolveIcon(DISCOVERY_ICON_MAP, option.value)}
										<button
											type="button"
											class={optionButtonClass(discoverySource === option.value)}
											onclick={(event) => {
												const target = event.currentTarget as HTMLButtonElement;
												void selectDiscoverySource(option.value, target.form);
											}}
											disabled={isTransitioning}
											aria-pressed={discoverySource === option.value}
										>
											<Icon class="size-5 text-foreground/90" aria-hidden="true" />
											<span class="font-medium">{option.label}</span>
										</button>
									{/each}
								</div>
							{/if}

							{#if activeStep >= QUESTION_COUNT}
								<div class="grid place-items-center gap-4 py-6 text-center" in:fade={{ duration: 300 }}>
									<div class="tick-wrap" aria-hidden="true">
										<svg class="tick-svg" viewBox="0 0 52 52">
											<circle class="tick-circle" cx="26" cy="26" r="25" fill="none" />
											<path class="tick-check" fill="none" d="M14 27l8 8 16-16" />
										</svg>
									</div>
									<div class="space-y-1">
										<p class="font-heading text-3xl font-semibold">Welcome to Ref@mncuchiinhuttt</p>
										<p class="text-sm text-muted-foreground">
											Your onboarding is complete. You can now start creating projects.
										</p>
									</div>
									<Button href="/dashboard" size="lg">Go to dashboard</Button>
								</div>
							{/if}
						</section>
					{/key}

					{#if form?.message}
						<p class="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
							{form.message}
						</p>
					{/if}
				</div>
			</section>
		</form>
	</main>
</div>

<style>
	.tick-wrap {
		display: grid;
		place-items: center;
		height: 6rem;
		width: 6rem;
		border-radius: 9999px;
		background: color-mix(in oklch, var(--color-primary) 10%, transparent);
		animation:
			tick-pop 0.48s cubic-bezier(0.16, 1, 0.3, 1) both,
			tick-glow 2.2s ease-in-out 0.65s infinite;
	}

	.tick-svg {
		height: 4.25rem;
		width: 4.25rem;
	}

	.tick-circle {
		stroke: var(--color-primary);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-dasharray: 166;
		stroke-dashoffset: 166;
		animation: draw-stroke 0.65s ease forwards;
	}

	.tick-check {
		stroke: var(--color-primary);
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-dasharray: 48;
		stroke-dashoffset: 48;
		animation:
			draw-stroke 0.35s ease 0.55s forwards,
			tick-bounce 0.4s ease 0.9s both;
	}

	@keyframes tick-pop {
		0% {
			transform: scale(0.78);
			opacity: 0.7;
		}
		100% {
			transform: scale(1);
			opacity: 1;
		}
	}

	@keyframes tick-glow {
		0%,
		100% {
			box-shadow: 0 0 0 0 color-mix(in oklch, var(--color-primary) 0%, transparent);
		}
		50% {
			box-shadow: 0 0 0 12px color-mix(in oklch, var(--color-primary) 10%, transparent);
		}
	}

	@keyframes tick-bounce {
		0% {
			transform: scale(0.88);
		}
		100% {
			transform: scale(1);
		}
	}

	@keyframes draw-stroke {
		to {
			stroke-dashoffset: 0;
		}
	}
</style>
