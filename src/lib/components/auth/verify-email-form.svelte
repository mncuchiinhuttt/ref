<script lang="ts">
	import { enhance } from '$app/forms';
	import { REGEXP_ONLY_DIGITS } from 'bits-ui';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as InputOTP from '$lib/components/ui/input-otp';
	import { Label } from '$lib/components/ui/label';

	type AuthFormState = {
		message?: string;
		activeTab?: 'login' | 'register';
		showVerify?: boolean;
		verifySource?: 'login' | 'register';
		email?: string;
		verificationEmail?: string;
		otp?: string;
	};

	let { form, source }: { form?: AuthFormState; source: 'login' | 'register' } = $props();
	let otpValue = $state('');

	$effect(() => {
		if (form?.showVerify && form?.verifySource === source) {
			otpValue = form?.otp ?? '';
		}
	});

	const prefilledEmail = $derived(
		form?.showVerify && form?.verifySource === source
			? (form?.verificationEmail ?? form?.email ?? '')
			: ''
	);
	const hasVerifyMessage = $derived(
		Boolean(form?.showVerify && form?.verifySource === source && form?.message)
	);
	const isPositiveMessage = $derived(
		Boolean(
			form?.showVerify &&
				form?.verifySource === source &&
				form?.message &&
				/(sent|created)/i.test(form.message)
		)
	);
</script>

<form class="grid gap-4" method="post" action="?/verifyEmailOtp" use:enhance>
	<input type="hidden" name="verifySource" value={source} />
	<div class="grid gap-2">
		<Label for="verify-email">Email</Label>
		<Input
			id="verify-email"
			name="email"
			type="email"
			autocomplete="email"
			required
			value={prefilledEmail}
		/>
	</div>

	<div class="grid gap-2">
		<div class="flex items-center justify-between gap-2">
			<Label for="verify-otp">Verification code</Label>
			<p class="text-xs text-muted-foreground">5 digits</p>
		</div>
		<input type="hidden" name="otp" value={otpValue} />
		<InputOTP.Root
			id="verify-otp"
			maxlength={5}
			pattern={REGEXP_ONLY_DIGITS}
			bind:value={otpValue}
			required
			class="justify-center"
		>
			{#snippet children({ cells })}
				<InputOTP.Group class="justify-center gap-2.5 *:data-[slot=input-otp-slot]:text-xl">
					{#each cells as cell (cell)}
						<InputOTP.Slot {cell} />
					{/each}
				</InputOTP.Group>
			{/snippet}
		</InputOTP.Root>
		<p class="text-center text-xs text-muted-foreground">Enter the 5-digit code sent to your email.</p>
	</div>

	<div class="flex flex-col gap-2 sm:flex-row">
		<Button type="submit" class="w-full sm:flex-1">Verify email</Button>
		<Button
			type="submit"
			variant="outline"
			class="w-full sm:w-auto"
			formaction="?/resendVerificationOtp"
			formnovalidate
		>
			Resend code
		</Button>
	</div>

	{#if hasVerifyMessage}
		<p
			class={isPositiveMessage
				? 'text-sm text-emerald-700 dark:text-emerald-300'
				: 'text-sm text-destructive'}
		>
			{form?.message}
		</p>
	{/if}
</form>
