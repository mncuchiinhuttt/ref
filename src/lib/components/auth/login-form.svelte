<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	type AuthFormState = {
		message?: string;
		activeTab?: 'login' | 'register' | 'verify';
		email?: string;
	};

	let { form }: { form?: AuthFormState } = $props();
</script>

<form class="grid gap-4" method="post" action="?/signInEmail" use:enhance>
	<div class="grid gap-2">
		<Label for="login-email">Email</Label>
		<Input
			id="login-email"
			name="email"
			type="email"
			autocomplete="email"
			required
			value={form?.activeTab === 'login' ? (form?.email ?? '') : ''}
		/>
	</div>
	<div class="grid gap-2">
		<Label for="login-password">Password</Label>
		<Input
			id="login-password"
			name="password"
			type="password"
			autocomplete="current-password"
			required
		/>
	</div>
	<Button type="submit" class="mt-1 w-full">Sign in to free workspace</Button>
	<p class="text-xs text-muted-foreground">No payment needed for current access.</p>
	{#if form?.activeTab === 'login' && form?.message}
		<p class="text-sm text-destructive">{form.message}</p>
	{/if}
</form>
