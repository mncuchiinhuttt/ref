import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import {
	citation,
	project,
	projectInvitation,
	projectMember,
	user as authUser
} from '$lib/server/db/schema';
import { and, desc, eq, ilike, inArray, ne, sql } from 'drizzle-orm';
import {
	createExpansionRequest,
	DEFAULT_ADDITIONAL_PER_WEEK,
	getCitationQuotaState,
	hasRmitEmailDomain,
	MAX_ADDITIONAL_PER_WEEK,
	MAX_EXPANSION_WEEKS
} from '$lib/server/citations/weekly-quota';

const toInt = (value: FormDataEntryValue | null): number | null => {
	const rawValue = value?.toString().trim();
	if (!rawValue) {
		return null;
	}

	const parsed = Number.parseInt(rawValue, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		return null;
	}

	return parsed;
};

const toValue = (value: FormDataEntryValue | null): string => value?.toString().trim() ?? '';

const normalizeSpace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;

const buildDefaultProjectName = (baseDisplayName: string, existingNames: string[]): string => {
	const root = `${baseDisplayName}'s project`;
	const normalizedNames = new Set(existingNames.map((item) => item.trim().toLowerCase()));

	if (!normalizedNames.has(root.toLowerCase())) {
		return root;
	}

	let suffix = 2;
	while (normalizedNames.has(`${root} ${suffix}`.toLowerCase())) {
		suffix += 1;
	}

	return `${root} ${suffix}`;
};

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		return redirect(302, '/auth');
	}

	let currentUser = event.locals.user;
	let rmitBonusApplied = false;

	const isUserRole = (currentUser.role ?? 'user') === 'user';
	const isEligibleRmitEmail = hasRmitEmailDomain(currentUser.email);
	if (isUserRole && isEligibleRmitEmail && !currentUser.isFromRmit) {
		await db
			.update(authUser)
			.set({
				isFromRmit: true
			})
			.where(eq(authUser.id, currentUser.id));

		currentUser = {
			...currentUser,
			isFromRmit: true
		};
		event.locals.user = currentUser;
		rmitBonusApplied = true;
	}

	const ownProjectRows = await db
		.select({
			id: project.id,
			name: project.name,
			citationStyle: project.citationStyle,
			updatedAt: project.updatedAt,
			ownerId: authUser.id,
			ownerName: authUser.name,
			ownerDisplayUsername: authUser.displayUsername,
			ownerUsername: authUser.username
		})
		.from(project)
		.innerJoin(authUser, eq(project.userId, authUser.id))
		.where(eq(project.userId, currentUser.id))
		.orderBy(desc(project.updatedAt));

	const memberProjectRows = await db
		.select({
			id: project.id,
			name: project.name,
			citationStyle: project.citationStyle,
			updatedAt: project.updatedAt,
			ownerId: authUser.id,
			ownerName: authUser.name,
			ownerDisplayUsername: authUser.displayUsername,
			ownerUsername: authUser.username
		})
		.from(projectMember)
		.innerJoin(project, eq(projectMember.projectId, project.id))
		.innerJoin(authUser, eq(project.userId, authUser.id))
		.where(eq(projectMember.userId, currentUser.id))
		.orderBy(desc(project.updatedAt));

	const mergedProjectMap = new Map<number, {
		id: number;
		name: string;
		citationStyle: string;
		updatedAt: Date;
		ownerId: string;
		ownerName: string;
		ownerDisplayUsername: string | null;
		ownerUsername: string | null;
		isOwner: boolean;
	}>();

	for (const row of ownProjectRows) {
		mergedProjectMap.set(row.id, {
			...row,
			isOwner: true
		});
	}

	for (const row of memberProjectRows) {
		if (!mergedProjectMap.has(row.id)) {
			mergedProjectMap.set(row.id, {
				...row,
				isOwner: row.ownerId === currentUser.id
			});
		}
	}

	const projectIds = Array.from(mergedProjectMap.keys());
	const citationCountRows =
		projectIds.length === 0
			? []
			: await db
					.select({
						projectId: citation.projectId,
						count: sql<number>`count(*)`
					})
					.from(citation)
					.where(inArray(citation.projectId, projectIds))
					.groupBy(citation.projectId);

	const citationCountMap = new Map<number, number>(citationCountRows.map((row) => [row.projectId, row.count]));

	const projects = Array.from(mergedProjectMap.values())
		.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
		.map((row) => ({
			id: row.id,
			name: row.name,
			citationStyle: row.citationStyle,
			citationCount: citationCountMap.get(row.id) ?? 0,
			isOwner: row.isOwner,
			owner: {
				id: row.ownerId,
				name: row.ownerName,
				displayUsername: row.ownerDisplayUsername,
				username: row.ownerUsername
			},
			updatedAt: row.updatedAt.toISOString()
		}));

	const invitationRows = await db
		.select({
			id: projectInvitation.id,
			projectId: project.id,
			projectName: project.name,
			inviterId: authUser.id,
			inviterName: authUser.name,
			inviterDisplayUsername: authUser.displayUsername,
			inviterUsername: authUser.username,
			inviterImage: authUser.image,
			createdAt: projectInvitation.createdAt
		})
		.from(projectInvitation)
		.innerJoin(project, eq(projectInvitation.projectId, project.id))
		.innerJoin(authUser, eq(projectInvitation.inviterUserId, authUser.id))
		.where(
			and(
				eq(projectInvitation.inviteeUserId, currentUser.id),
				eq(projectInvitation.status, 'pending')
			)
		)
		.orderBy(desc(projectInvitation.createdAt));

	const quota = await getCitationQuotaState({
		userId: currentUser.id,
		role: currentUser.role ?? 'user',
		isFromRmit: currentUser.isFromRmit,
		email: currentUser.email
	});

	return {
		rmitBonusApplied,
		user: {
			id: currentUser.id,
			email: currentUser.email,
			name: currentUser.name,
			image: currentUser.image,
			username: currentUser.username ?? null,
			displayUsername: currentUser.displayUsername ?? null,
			role: currentUser.role ?? 'user',
			isFromRmit: Boolean(currentUser.isFromRmit)
		},
		citationQuota: quota,
		projects,
		invitations: invitationRows.map((row) => ({
			id: row.id,
			projectId: row.projectId,
			projectName: row.projectName,
			inviter: {
				id: row.inviterId,
				name: row.inviterName,
				displayUsername: row.inviterDisplayUsername,
				username: row.inviterUsername,
				image: row.inviterImage
			},
			createdAt: row.createdAt.toISOString()
		}))
	};
};

export const actions: Actions = {
	createProject: async (event) => {
		if (!event.locals.user) {
			return redirect(302, '/auth');
		}

		const currentUser = event.locals.user;
		const displayName = currentUser.displayUsername || currentUser.name;
		const existingProjectNames = await db
			.select({ name: project.name })
			.from(project)
			.where(eq(project.userId, currentUser.id));

		const projectName = buildDefaultProjectName(
			displayName,
			existingProjectNames.map((item) => item.name)
		);

		const [createdProject] = await db
			.insert(project)
			.values({
				userId: currentUser.id,
				name: projectName,
				citationStyle: 'APA'
			})
			.returning({ id: project.id });

		return redirect(302, `/dashboard/projects/${createdProject.id}`);
	},
	updateAccount: async (event) => {
		if (!event.locals.user) {
			return redirect(302, '/auth');
		}

		const currentUser = event.locals.user;
		const formData = await event.request.formData();
		const accountName = normalizeSpace(toValue(formData.get('name')));
		const accountDisplayUsername = normalizeSpace(toValue(formData.get('displayUsername')));
		const accountUsername = toValue(formData.get('username')).toLowerCase();

		if (!accountName || !accountDisplayUsername || !accountUsername) {
			return fail(400, {
				formName: 'updateAccount',
				accountName,
				accountDisplayUsername,
				accountUsername,
				accountMessage: 'Name, display name, and username are required.'
			});
		}

		if (accountName.length < 2) {
			return fail(400, {
				formName: 'updateAccount',
				accountName,
				accountDisplayUsername,
				accountUsername,
				accountMessage: 'Name must be at least 2 characters.'
			});
		}

		if (accountDisplayUsername.length < 2) {
			return fail(400, {
				formName: 'updateAccount',
				accountName,
				accountDisplayUsername,
				accountUsername,
				accountMessage: 'Display name must be at least 2 characters.'
			});
		}

		if (!USERNAME_PATTERN.test(accountUsername)) {
			return fail(400, {
				formName: 'updateAccount',
				accountName,
				accountDisplayUsername,
				accountUsername,
				accountMessage: 'Username must be 3-30 characters (letters, numbers, underscore only).'
			});
		}

		const [usernameConflict] = await db
			.select({ id: authUser.id })
			.from(authUser)
			.where(and(ilike(authUser.username, accountUsername), ne(authUser.id, currentUser.id)))
			.limit(1);

		if (usernameConflict) {
			return fail(409, {
				formName: 'updateAccount',
				accountName,
				accountDisplayUsername,
				accountUsername,
				accountMessage: 'That username is already in use.'
			});
		}

		await db
			.update(authUser)
			.set({
				name: accountName,
				displayUsername: accountDisplayUsername,
				username: accountUsername
			})
			.where(eq(authUser.id, currentUser.id));

		event.locals.user = {
			...currentUser,
			name: accountName,
			displayUsername: accountDisplayUsername,
			username: accountUsername
		};

		return {
			formName: 'updateAccount',
			accountSuccess: true,
			accountName,
			accountDisplayUsername,
			accountUsername,
			accountMessage: 'Account updated successfully.'
		};
	},
	acceptInvitation: async (event) => {
		if (!event.locals.user) {
			return redirect(302, '/auth');
		}

		const invitationId = toInt((await event.request.formData()).get('invitationId'));
		if (!invitationId) {
			return fail(400, { message: 'Invalid invitation.' });
		}

		const userId = event.locals.user.id;

		const [acceptedInvitation] = await db
			.update(projectInvitation)
			.set({
				status: 'accepted',
				respondedAt: new Date()
			})
			.where(
				and(
					eq(projectInvitation.id, invitationId),
					eq(projectInvitation.inviteeUserId, userId),
					eq(projectInvitation.status, 'pending')
				)
			)
			.returning({
				id: projectInvitation.id,
				projectId: projectInvitation.projectId
			});

		if (!acceptedInvitation) {
			const [existingInvitation] = await db
				.select({
					projectId: projectInvitation.projectId,
					status: projectInvitation.status
				})
				.from(projectInvitation)
				.where(
					and(
						eq(projectInvitation.id, invitationId),
						eq(projectInvitation.inviteeUserId, userId)
					)
				)
				.limit(1);

			if (!existingInvitation) {
				return fail(404, { message: 'Invitation not found.' });
			}

			if (existingInvitation.status === 'accepted') {
				await db
					.insert(projectMember)
					.values({
						projectId: existingInvitation.projectId,
						userId,
						role: 'member'
					})
					.onConflictDoNothing();

				return redirect(302, `/dashboard/projects/${existingInvitation.projectId}`);
			}

			return fail(409, { message: 'Invitation is no longer pending.' });
		}

		await db
			.insert(projectMember)
			.values({
				projectId: acceptedInvitation.projectId,
				userId,
				role: 'member'
			})
			.onConflictDoNothing();

		return redirect(302, `/dashboard/projects/${acceptedInvitation.projectId}`);
	},
	requestCitationExpansion: async (event) => {
		if (!event.locals.user) {
			return redirect(302, '/auth');
		}

		const currentUser = event.locals.user;
		if ((currentUser.role ?? 'user') !== 'user') {
			return fail(403, {
				formName: 'requestCitationExpansion',
				expansionMessage: 'Only users can request weekly citation expansion.'
			});
		}

		const formData = await event.request.formData();
		const requestedWeeksRaw = toInt(formData.get('requestedWeeks'));
		const additionalPerWeekRaw = toInt(formData.get('additionalPerWeek'));
		const reason = normalizeSpace(toValue(formData.get('reason')));

		const requestedWeeks =
			requestedWeeksRaw && requestedWeeksRaw > 0
				? Math.min(MAX_EXPANSION_WEEKS, requestedWeeksRaw)
				: 1;
		const additionalPerWeek =
			additionalPerWeekRaw && additionalPerWeekRaw > 0
				? Math.min(MAX_ADDITIONAL_PER_WEEK, additionalPerWeekRaw)
				: DEFAULT_ADDITIONAL_PER_WEEK;

		const requestResult = await createExpansionRequest({
			userId: currentUser.id,
			requestedWeeks,
			additionalPerWeek,
			reason
		});

		return {
			formName: 'requestCitationExpansion',
			expansionSuccess: true,
			expansionMessage: requestResult.message
		};
	},
	rejectInvitation: async (event) => {
		if (!event.locals.user) {
			return redirect(302, '/auth');
		}

		const invitationId = toInt((await event.request.formData()).get('invitationId'));
		if (!invitationId) {
			return fail(400, { message: 'Invalid invitation.' });
		}

		const [invitation] = await db
			.select({ id: projectInvitation.id })
			.from(projectInvitation)
			.where(
				and(
					eq(projectInvitation.id, invitationId),
					eq(projectInvitation.inviteeUserId, event.locals.user.id),
					eq(projectInvitation.status, 'pending')
				)
			)
			.limit(1);

		if (!invitation) {
			return fail(404, { message: 'Invitation not found.' });
		}

		await db
			.update(projectInvitation)
			.set({
				status: 'rejected',
				respondedAt: new Date()
			})
			.where(eq(projectInvitation.id, invitation.id));

		return redirect(302, '/dashboard');
	},
	signOut: async (event) => {
		await auth.api.signOut({
			headers: event.request.headers
		});

		return redirect(302, '/auth');
	}
};
