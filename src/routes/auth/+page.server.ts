import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { APIError } from 'better-auth/api';
import { auth } from '$lib/server/auth';
import { DASHBOARD_PATH, needsOnboarding, ONBOARDING_PATH } from '$lib/server/onboarding';

const toValue = (value: FormDataEntryValue | null): string => value?.toString().trim() ?? '';
const OTP_PATTERN = /^\d{5}$/;
type VerifySource = 'login' | 'register';

const toVerifySource = (value: FormDataEntryValue | null): VerifySource => {
	return value?.toString() === 'login' ? 'login' : 'register';
};

const getUnexpectedErrorMessage = (error: unknown): string => {
	if (error instanceof Error) {
		return error.message;
	}

	if (typeof error === 'string') {
		return error;
	}

	return 'Unknown error';
};

const isSchemaSyncError = (message: string): boolean => {
	const normalized = message.toLowerCase();

	return (
		normalized.includes('column') && normalized.includes('does not exist')
	) || (
		normalized.includes('relation') && normalized.includes('does not exist')
	);
};

const isEmailNotVerifiedError = (message: string): boolean => {
	const normalized = message.toLowerCase();
	return normalized.includes('email not verified');
};

const getAvatarUrl = (displayName: string): string => {
	const seed = encodeURIComponent(displayName);
	return `https://api.dicebear.com/9.x/initials/svg?seed=${seed}&backgroundType=gradientLinear`;
};

export const load: PageServerLoad = (event) => {
	if (event.locals.user) {
		return redirect(302, needsOnboarding(event.locals.user) ? ONBOARDING_PATH : DASHBOARD_PATH);
	}

	return {};
};

export const actions: Actions = {
	signInEmail: async (event) => {
		const formData = await event.request.formData();
		const email = toValue(formData.get('email'));
		const password = toValue(formData.get('password'));

		if (!email || !password) {
			return fail(400, {
				activeTab: 'login',
				email,
				message: 'Email and password are required.'
			});
		}

		try {
			await auth.api.signInEmail({
				body: {
					email,
					password,
					callbackURL: ONBOARDING_PATH
				},
				headers: event.request.headers
			});
		} catch (error) {
			if (error instanceof APIError) {
				if (isEmailNotVerifiedError(error.message || '')) {
					let message =
						'Your email is not verified yet. We sent a new 5-digit verification code. Enter it below to continue.';

					try {
						await auth.api.sendVerificationOTP({
							body: {
								email,
								type: 'email-verification'
							},
							headers: event.request.headers
						});
					} catch (resendError) {
						const resendMessage = getUnexpectedErrorMessage(resendError);
						console.error('[auth/signInEmail] Failed to resend verification OTP', {
							email,
							message: resendMessage,
							error: resendError
						});

						message =
							'Your email is not verified yet. Enter your 5-digit verification code or use Resend code.';
					}

					return fail(403, {
						activeTab: 'login',
						showVerify: true,
						verifySource: 'login',
						email,
						verificationEmail: email,
						message
					});
				}

				return fail(400, {
					activeTab: 'login',
					email,
					message: error.message || 'Login failed.'
				});
			}

			const message = getUnexpectedErrorMessage(error);
			console.error('[auth/signInEmail] Unexpected error', {
				email,
				message,
				error
			});

			return fail(500, {
				activeTab: 'login',
				email,
				message: 'Unexpected server error during login.'
			});
		}

		return redirect(302, DASHBOARD_PATH);
	},
	signUpEmail: async (event) => {
		const formData = await event.request.formData();
		const email = toValue(formData.get('email'));
		const username = toValue(formData.get('username'));
		const displayName = toValue(formData.get('displayName'));
		const password = toValue(formData.get('password'));

		if (!email || !username || !displayName || !password) {
			return fail(400, {
				activeTab: 'register',
				email,
				username,
				displayName,
				message: 'Email, username, display name, and password are required.'
			});
		}

		if (password.length < 8) {
			return fail(400, {
				activeTab: 'register',
				email,
				username,
				displayName,
				message: 'Password must be at least 8 characters.'
			});
		}

		try {
			await auth.api.signUpEmail({
				body: {
					email,
					password,
					name: displayName,
					image: getAvatarUrl(displayName),
					username,
					displayUsername: displayName,
					callbackURL: ONBOARDING_PATH
				},
				headers: event.request.headers
			});
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, {
					activeTab: 'register',
					email,
					username,
					displayName,
					message: error.message || 'Registration failed.'
				});
			}

			const message = getUnexpectedErrorMessage(error);
			console.error('[auth/signUpEmail] Unexpected error', {
				email,
				username,
				message,
				error
			});

			const userMessage = isSchemaSyncError(message)
				? 'Database schema is out of date. Run "npm run db:push" and try again.'
				: 'Unexpected server error during registration.';

			return fail(500, {
				activeTab: 'register',
				email,
				username,
				displayName,
				message: userMessage
			});
		}

		return {
			activeTab: 'register',
			showVerify: true,
			verifySource: 'register',
			email,
			verificationEmail: email,
			message:
				'Account created. We sent a 5-digit verification code to your email. Enter it below to finish setup.'
		};
	},
	verifyEmailOtp: async (event) => {
		const formData = await event.request.formData();
		const verifySource = toVerifySource(formData.get('verifySource'));
		const email = toValue(formData.get('email')).toLowerCase();
		const otp = toValue(formData.get('otp')).replace(/\s+/g, '');

		if (!email || !otp) {
			return fail(400, {
				activeTab: verifySource,
				showVerify: true,
				verifySource,
				email,
				verificationEmail: email,
				otp,
				message: 'Email and verification code are required.'
			});
		}

		if (!OTP_PATTERN.test(otp)) {
			return fail(400, {
				activeTab: verifySource,
				showVerify: true,
				verifySource,
				email,
				verificationEmail: email,
				otp,
				message: 'Verification code must contain exactly 5 digits.'
			});
		}

		try {
			await auth.api.verifyEmailOTP({
				body: {
					email,
					otp
				},
				headers: event.request.headers
			});
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, {
					activeTab: verifySource,
					showVerify: true,
					verifySource,
					email,
					verificationEmail: email,
					otp,
					message: error.message || 'Unable to verify your code. Please try again.'
				});
			}

			const message = getUnexpectedErrorMessage(error);
			console.error('[auth/verifyEmailOtp] Unexpected error', {
				email,
				message,
				error
			});

			return fail(500, {
				activeTab: verifySource,
				showVerify: true,
				verifySource,
				email,
				verificationEmail: email,
				otp,
				message: 'Unexpected server error while verifying your email.'
			});
		}

		return redirect(302, ONBOARDING_PATH);
	},
	resendVerificationOtp: async (event) => {
		const formData = await event.request.formData();
		const verifySource = toVerifySource(formData.get('verifySource'));
		const email = toValue(formData.get('email')).toLowerCase();

		if (!email) {
			return fail(400, {
				activeTab: verifySource,
				showVerify: true,
				verifySource,
				message: 'Email is required to resend the verification code.'
			});
		}

		try {
			await auth.api.sendVerificationOTP({
				body: {
					email,
					type: 'email-verification'
				},
				headers: event.request.headers
			});
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, {
					activeTab: verifySource,
					showVerify: true,
					verifySource,
					email,
					verificationEmail: email,
					message: error.message || 'Unable to resend verification code.'
				});
			}

			const message = getUnexpectedErrorMessage(error);
			console.error('[auth/resendVerificationOtp] Unexpected error', {
				email,
				message,
				error
			});

			return fail(500, {
				activeTab: verifySource,
				showVerify: true,
				verifySource,
				email,
				verificationEmail: email,
				message: 'Unexpected server error while resending code.'
			});
		}

		return {
			activeTab: verifySource,
			showVerify: true,
			verifySource,
			email,
			verificationEmail: email,
			message: 'A new 5-digit verification code has been sent to your inbox.'
		};
	}
};
