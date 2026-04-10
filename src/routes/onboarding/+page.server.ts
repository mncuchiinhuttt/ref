import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import {
	ACADEMIC_ROLE_VALUES,
	DISCOVERY_SOURCE_VALUES,
	RMIT_AFFILIATION_VALUES
} from '$lib/constants/onboarding';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { DASHBOARD_PATH, DEBUG_FORCE_ONBOARDING, needsOnboarding } from '$lib/server/onboarding';

const toValue = (value: FormDataEntryValue | null): string => value?.toString().trim() ?? '';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		return redirect(302, '/auth');
	}

	if (!needsOnboarding(event.locals.user)) {
		return redirect(302, DASHBOARD_PATH);
	}

	const shouldReuseStoredAnswers = DEBUG_FORCE_ONBOARDING && Boolean(event.locals.user.onboardingCompleted);

	return {
		debug: DEBUG_FORCE_ONBOARDING,
		prefill: {
			academicRole: shouldReuseStoredAnswers ? (event.locals.user.academicRole ?? '') : '',
			discoverySource: shouldReuseStoredAnswers ? (event.locals.user.discoverySource ?? '') : '',
			isFromRmit:
				shouldReuseStoredAnswers && typeof event.locals.user.isFromRmit === 'boolean'
					? event.locals.user.isFromRmit
					: null
		}
	};
};

export const actions: Actions = {
	completeSurvey: async (event) => {
		if (!event.locals.user) {
			return redirect(302, '/auth');
		}

		const formData = await event.request.formData();
		const academicRole = toValue(formData.get('academicRole'));
		const rmitAffiliation = toValue(formData.get('rmitAffiliation'));
		const discoverySource = toValue(formData.get('discoverySource'));

		if (!ACADEMIC_ROLE_VALUES.has(academicRole)) {
			return fail(400, {
				message: 'Please choose your role to continue.',
				academicRole,
				rmitAffiliation,
				discoverySource
			});
		}

		if (!RMIT_AFFILIATION_VALUES.has(rmitAffiliation)) {
			return fail(400, {
				message: 'Please tell us whether you are from RMIT University.',
				academicRole,
				rmitAffiliation,
				discoverySource
			});
		}

		if (!DISCOVERY_SOURCE_VALUES.has(discoverySource)) {
			return fail(400, {
				message: 'Please share how you heard about this website.',
				academicRole,
				rmitAffiliation,
				discoverySource
			});
		}

		await db
			.update(user)
			.set({
				academicRole,
				isFromRmit: rmitAffiliation === 'yes',
				discoverySource,
				onboardingCompleted: true,
				updatedAt: new Date()
			})
			.where(eq(user.id, event.locals.user.id));

		return {
			success: true
		};
	},
	signOut: async (event) => {
		await auth.api.signOut({
			headers: event.request.headers
		});

		return redirect(302, '/');
	}
};
