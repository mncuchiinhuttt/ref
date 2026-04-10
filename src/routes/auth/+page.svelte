<script lang="ts">
	import AuthPage from '$lib/components/pages/auth-page.svelte';
	import type { ActionData } from './$types';

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

	let { form }: { form?: ActionData } = $props();

	const normalizedForm: AuthFormState | undefined = $derived(
		form
			? {
					...form,
					activeTab: form.activeTab === 'register' ? 'register' : 'login',
					verifySource:
						form.verifySource === 'register'
							? 'register'
							: form.verifySource === 'login'
								? 'login'
								: undefined,
					showVerify: Boolean(form.showVerify)
			  }
			: undefined
	);
</script>

<AuthPage form={normalizedForm} />
