<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	type AuthFormState = {
		message?: string;
		activeTab?: 'login' | 'register' | 'verify';
		email?: string;
		username?: string;
		displayName?: string;
	};

	let { form }: { form?: AuthFormState } = $props();
</script>

<form class="grid gap-4" method="post" action="?/signUpEmail" use:enhance>
	<div class="grid gap-2">
		<Label for="register-email">Email</Label>
		<Input
			id="register-email"
			name="email"
			type="email"
			autocomplete="email"
			required
			value={form?.activeTab === 'register' ? (form?.email ?? '') : ''}
		/>
	</div>
	<div class="grid gap-2">
		<Label for="register-username">Username</Label>
		<Input
			id="register-username"
			name="username"
			autocomplete="username"
			placeholder="jane_research"
			required
			value={form?.activeTab === 'register' ? (form?.username ?? '') : ''}
		/>
	</div>
	<div class="grid gap-2">
		<Label for="register-display-name">Display name</Label>
		<Input
			id="register-display-name"
			name="displayName"
			autocomplete="name"
			placeholder="Jane Doe"
			required
			value={form?.activeTab === 'register' ? (form?.displayName ?? '') : ''}
		/>
	</div>
	<div class="grid gap-2">
		<Label for="register-password">Password</Label>
		<Input
			id="register-password"
			name="password"
			type="password"
			autocomplete="new-password"
			required
		/>
	</div>
	<p class="text-xs text-muted-foreground">
		Free account includes 5 citation styles today (with more coming), plus collaboration features.
	</p>
	<Button type="submit" class="w-full">Create free account</Button>
	{#if form?.activeTab === 'register' && form?.message}
		<p class="text-sm text-destructive">{form.message}</p>
	{/if}
</form>
