type OnboardingUserLike = {
	onboardingCompleted?: boolean | null;
};

export const ONBOARDING_PATH = '/onboarding';
export const DASHBOARD_PATH = '/dashboard';

// Toggle to true while developing the survey flow to force users through onboarding again.
export const DEBUG_FORCE_ONBOARDING = false;

const PATH_PREFIX_ALLOWLIST = ['/api/auth', '/_app'];
const PATH_EXACT_ALLOWLIST = new Set(['/favicon.ico', '/robots.txt']);

export const isFrameworkOrAuthPath = (pathname: string): boolean => {
	if (PATH_EXACT_ALLOWLIST.has(pathname)) {
		return true;
	}

	return PATH_PREFIX_ALLOWLIST.some((prefix) => pathname.startsWith(prefix));
};

export const isOnboardingPath = (pathname: string): boolean =>
	pathname === ONBOARDING_PATH || pathname.startsWith(`${ONBOARDING_PATH}/`);

export const needsOnboarding = (user: OnboardingUserLike | null | undefined): boolean => {
	if (!user) {
		return false;
	}

	if (DEBUG_FORCE_ONBOARDING) {
		return true;
	}

	return !user.onboardingCompleted;
};