import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { emailOTP, username } from 'better-auth/plugins';
import { Resend } from 'resend';
import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { buildVerificationOTPEmail } from '$lib/server/emails/verification-otp';

const isDefined = (value: string | undefined): value is string => Boolean(value);
const DEFAULT_DEV_BASE_URL = 'http://localhost:5173';
const PRODUCTION_MODES = new Set(['prod', 'production']);

const toOrigin = (value: string | undefined): string | undefined => {
	const trimmedValue = value?.trim();

	if (!trimmedValue) {
		return undefined;
	}

	try {
		return new URL(trimmedValue).origin;
	} catch {
		return undefined;
	}
};

const getRequestOrigins = (request?: Request): string[] => {
	if (!request) {
		return [];
	}

	const requestOrigin = new URL(request.url).origin;
	const forwardedHost = request.headers.get('x-forwarded-host') ?? undefined;
	const forwardedProto = request.headers.get('x-forwarded-proto') ?? undefined;
	const forwardedOrigin =
		forwardedHost && forwardedProto ? `${forwardedProto}://${forwardedHost}` : undefined;

	return [requestOrigin, forwardedOrigin].filter(isDefined);
};

const runtimeMode = (env.MODE ?? env.NODE_ENV ?? 'dev').trim().toLowerCase();
const isProductionMode = PRODUCTION_MODES.has(runtimeMode);
const configuredBaseURL = toOrigin(env.BETTER_AUTH_URL) ?? toOrigin(env.ORIGIN);
const resolvedBaseURL = configuredBaseURL ?? (isProductionMode ? undefined : DEFAULT_DEV_BASE_URL);
const VERIFICATION_OTP_LENGTH = 5;
const VERIFICATION_OTP_EXPIRY_SECONDS = 300;
const VERIFICATION_OTP_EXPIRY_MINUTES = Math.floor(VERIFICATION_OTP_EXPIRY_SECONDS / 60);
const VERIFICATION_EMAIL_FROM =
	'No Reply - Ref@mncuchiinhuttt <no-reply-ref@mncuchiinhuttt.dev>';
const resendApiKey = env.RESEND_API_KEY?.trim();
const resendClient = resendApiKey ? new Resend(resendApiKey) : null;

const getResendClient = (): Resend => {
	if (!resendClient) {
		throw new Error('Missing RESEND_API_KEY. Add it to your environment to send verification OTP emails.');
	}

	return resendClient;
};

if (!resolvedBaseURL && isProductionMode) {
	throw new Error(
		'Missing Better Auth base URL in production mode. Set BETTER_AUTH_URL (preferred) or ORIGIN when MODE is prod/production.'
	);
}

export const auth = betterAuth({
	secret: env.BETTER_AUTH_SECRET,
	baseURL: resolvedBaseURL,
	database: drizzleAdapter(db, { provider: 'pg' }),
	user: {
		additionalFields: {
			role: {
				type: 'string',
				required: false,
				defaultValue: 'user',
				input: false
			},
			onboardingCompleted: {
				type: 'boolean',
				required: false,
				defaultValue: false,
				input: false
			},
			academicRole: {
				type: 'string',
				required: false,
				defaultValue: '',
				input: false
			},
			isFromRmit: {
				type: 'boolean',
				required: false,
				defaultValue: false,
				input: false
			},
			discoverySource: {
				type: 'string',
				required: false,
				defaultValue: '',
				input: false
			}
		}
	},
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true
	},
	emailVerification: {
		autoSignInAfterVerification: true
	},
	trustedOrigins: (request) => {
		return Array.from(
			new Set([configuredBaseURL, resolvedBaseURL, ...getRequestOrigins(request)].filter(isDefined))
		);
	},
	advanced: {
		trustedProxyHeaders: true
	},
	plugins: [
		emailOTP({
			otpLength: VERIFICATION_OTP_LENGTH,
			expiresIn: VERIFICATION_OTP_EXPIRY_SECONDS,
			sendVerificationOnSignUp: true,
			overrideDefaultEmailVerification: true,
			sendVerificationOTP: async ({ email, otp, type }) => {
				const resend = getResendClient();
				const payload = buildVerificationOTPEmail({
					email,
					otp,
					type,
					expiresInMinutes: VERIFICATION_OTP_EXPIRY_MINUTES
				});

				await resend.emails.send({
					from: VERIFICATION_EMAIL_FROM,
					to: email,
					subject: payload.subject,
					html: payload.html,
					text: payload.text
				});
			}
		}),
		username(),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
