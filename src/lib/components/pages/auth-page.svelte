<script lang="ts">
	import { onMount } from 'svelte';
	import SiteHeader from '$lib/components/common/site-header.svelte';
	import LoginForm from '$lib/components/auth/login-form.svelte';
	import RegisterForm from '$lib/components/auth/register-form.svelte';
	import VerifyEmailForm from '$lib/components/auth/verify-email-form.svelte';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { Badge } from '$lib/components/ui/badge';

	type AuthFormState = {
		message?: string;
		activeTab?: 'login' | 'register';
		showVerify?: boolean;
		verifySource?: 'login' | 'register';
		email?: string;
		username?: string;
		displayName?: string;
		verificationEmail?: string;
		otp?: string;
	};

	let { form }: { form?: AuthFormState } = $props();
	let selectedTab = $state<'login' | 'register'>('login');

	const activeTab = $derived.by(() => {
		if (form?.activeTab === 'register') {
			return 'register';
		}

		if (form?.activeTab === 'login') {
			return 'login';
		}

		return selectedTab;
	});

	const showLoginVerification = $derived(
		Boolean(form?.showVerify && form?.verifySource === 'login')
	);
	const showRegisterVerification = $derived(
		Boolean(form?.showVerify && form?.verifySource === 'register')
	);

	onMount(() => {
		let controls: Array<{ stop: () => void }> = [];
		let cancelled = false;

		void import('motion/mini')
			.then(({ animate }) => {
				if (cancelled) {
					return;
				}

				const revealItems = Array.from(document.querySelectorAll<HTMLElement>('#auth-page [data-auth-reveal]'));

				controls = revealItems.map((item, index) =>
					animate(
						item,
						{ opacity: [0, 1], transform: ['translateY(16px)', 'translateY(0px)'] },
						{ duration: 0.45, delay: index * 0.08, ease: 'easeOut' }
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

<div
	id="auth-page"
	class="min-h-dvh bg-[radial-gradient(circle_at_20%_10%,color-mix(in_oklch,var(--color-amber-400)_30%,transparent),transparent_35%),radial-gradient(circle_at_80%_90%,color-mix(in_oklch,var(--color-sky-500)_20%,transparent),transparent_40%)]"
>
	<SiteHeader showAuthCta={false} showDashboardCta={false} subtitle="Free citation workspace access" />
	<main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-2 lg:px-8 lg:py-12">
		<section class="space-y-4" data-auth-reveal>
			<Badge variant="secondary" class="w-fit">Free account</Badge>
			<h1 class="font-heading text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
				Create your free account and start citing right away.
			</h1>
			<p class="max-w-xl text-pretty text-muted-foreground">
				No subscription required. Use 5 citation styles now (including RMIT Harvard), share projects with
				others to contribute, and keep building your references in one place.
			</p>
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="rounded-xl border border-border/50 bg-card/70 p-4">
					<p class="font-heading text-lg">$0 to start</p>
					<p class="text-sm text-muted-foreground">Free access for citation work</p>
				</div>
				<div class="rounded-xl border border-border/50 bg-card/70 p-4">
					<p class="font-heading text-lg">5 styles available</p>
					<p class="text-sm text-muted-foreground">Includes RMIT Harvard style</p>
				</div>
				<div class="rounded-xl border border-border/50 bg-card/70 p-4 sm:col-span-2">
					<p class="font-heading text-lg">Collaboration ready</p>
					<p class="text-sm text-muted-foreground">Share projects so classmates can contribute together</p>
				</div>
			</div>
		</section>

		<Card class="border-border/60 bg-card/85 shadow-sm backdrop-blur" data-auth-reveal>
			<CardHeader>
				<CardTitle class="font-heading text-2xl">Welcome to your free workspace</CardTitle>
				<CardDescription>Sign in or create a free account to start generating citations.</CardDescription>
			</CardHeader>
			<CardContent>
				<Tabs
					value={activeTab}
					onValueChange={(value) => {
						selectedTab = value === 'register' ? 'register' : 'login';
					}}
					class="w-full"
				>
					<TabsList variant="line" class="mb-5 grid w-full grid-cols-2">
						<TabsTrigger value="login">Login</TabsTrigger>
						<TabsTrigger value="register">Register</TabsTrigger>
					</TabsList>
					<TabsContent value="login">
						{#if showLoginVerification}
							<VerifyEmailForm {form} source="login" />
						{:else}
							<LoginForm {form} />
						{/if}
					</TabsContent>
					<TabsContent value="register">
						{#if showRegisterVerification}
							<VerifyEmailForm {form} source="register" />
						{:else}
							<RegisterForm {form} />
						{/if}
					</TabsContent>
				</Tabs>
			</CardContent>
		</Card>
	</main>
</div>
