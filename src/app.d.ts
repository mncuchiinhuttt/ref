import type { User, Session } from 'better-auth/minimal';

type AppUser = User & {
	username?: string;
	displayUsername?: string;
	role?: 'user' | 'admin';
	onboardingCompleted?: boolean;
	academicRole?: string;
	isFromRmit?: boolean;
	discoverySource?: string;
};

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
				user?: AppUser;
			session?: Session;
		}

		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
