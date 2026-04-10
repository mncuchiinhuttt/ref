<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import ThemeToggle from '$lib/components/common/theme-toggle.svelte';

	let {
		title = 'ref@mncuchiinhuttt',
		subtitle = 'Citation workspace',
		showAuthCta = true,
		showDashboardCta = true,
		showAdminCta = false,
		adminHref = '/admin',
		showSignOutCta = false,
		signOutAction = '?/signOut'
	} = $props<{
		title?: string;
		subtitle?: string;
		showAuthCta?: boolean;
		showDashboardCta?: boolean;
		showAdminCta?: boolean;
		adminHref?: string;
		showSignOutCta?: boolean;
		signOutAction?: string;
	}>();

	const pathname = $derived(page.url.pathname as string);
</script>

<header class="sticky top-0 z-30 border-b border-border/40 bg-background/70 backdrop-blur-lg">
	<div class="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
		<a href={resolve('/')} class="group flex min-w-0 items-center gap-3">
			<div class="min-w-0">
				<p class="font-heading truncate text-base font-semibold tracking-tight sm:text-lg">{title}</p>
				<p class="truncate text-xs text-muted-foreground sm:text-sm">{subtitle}</p>
			</div>
		</a>

		<div class="flex items-center gap-2">
			<ThemeToggle />
			{#if showDashboardCta}
				<Button
					href="/dashboard"
					variant={pathname === '/dashboard' ? 'default' : 'ghost'}
					size="sm"
				>
					Dashboard
				</Button>
			{/if}
			{#if showAdminCta}
				<Button href={adminHref} variant={pathname.startsWith('/admin') ? 'default' : 'ghost'} size="sm">
					Admin
				</Button>
			{/if}
			{#if showAuthCta}
				<Button href="/auth" variant={pathname === '/auth' ? 'default' : 'outline'} size="sm">
					Login / Register
				</Button>
			{/if}
			{#if showSignOutCta}
				<form method="post" action={signOutAction} use:enhance>
					<Button type="submit" variant="outline" size="sm">Logout</Button>
				</form>
			{/if}
		</div>
	</div>
</header>
