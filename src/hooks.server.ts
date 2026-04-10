import { redirect, type Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import {
	DASHBOARD_PATH,
	isFrameworkOrAuthPath,
	isOnboardingPath,
	needsOnboarding,
	ONBOARDING_PATH
} from '$lib/server/onboarding';
import { svelteKitHandler } from 'better-auth/svelte-kit';

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	const pathname = event.url.pathname;
	if (event.locals.user && !isFrameworkOrAuthPath(pathname)) {
		const mustCompleteOnboarding = needsOnboarding(event.locals.user);

		if (mustCompleteOnboarding && !isOnboardingPath(pathname)) {
			throw redirect(302, ONBOARDING_PATH);
		}

		if (!mustCompleteOnboarding && isOnboardingPath(pathname)) {
			throw redirect(302, DASHBOARD_PATH);
		}
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = handleBetterAuth;
