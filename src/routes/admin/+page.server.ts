import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { auth } from '$lib/server/auth';
import {
	citation,
	citationGenerationEvent,
	citationQuotaRequest,
	project,
	user as authUser
} from '$lib/server/db/schema';
import {
	applyApprovedExpansionRequest,
	rejectExpansionRequest
} from '$lib/server/citations/weekly-quota';

const toInt = (value: FormDataEntryValue | null): number | null => {
	const raw = value?.toString().trim();
	if (!raw) {
		return null;
	}

	const parsed = Number.parseInt(raw, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		return null;
	}

	return parsed;
};

const toValue = (value: FormDataEntryValue | null): string => value?.toString().trim() ?? '';

const allowedRoles = new Set(['user', 'admin']);
const DAILY_GENERATION_DAYS = 30;

const startOfUtcDay = (value = new Date()): Date => {
	const start = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
	start.setUTCHours(0, 0, 0, 0);
	return start;
};

const toIsoDate = (value: Date): string => value.toISOString().slice(0, 10);

type CitationAiMetadataItem = {
	citationId?: number | null;
	sourceName?: string;
	sourceType?: string;
	sourceText?: string;
	method?: string;
	reason?: string;
};

type CitationGenerationMetadataPayload = {
	style?: string;
	mode?: string;
	fromStyle?: string | null;
	citationId?: number | null;
	ai?: {
		requiredCount?: number;
		totalCount?: number;
		items?: CitationAiMetadataItem[];
	};
};

const toSafeString = (value: unknown): string => {
	if (typeof value !== 'string') {
		return '';
	}

	return value.trim();
};

const parseCitationGenerationMetadata = (
	value: string | null
): CitationGenerationMetadataPayload | null => {
	if (!value) {
		return null;
	}

	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== 'object') {
			return null;
		}

		return parsed as CitationGenerationMetadataPayload;
	} catch {
		return null;
	}
};

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		return redirect(302, '/auth');
	}

	if ((event.locals.user.role ?? 'user') !== 'admin') {
		return redirect(302, '/dashboard');
	}

	const seriesEndExclusive = startOfUtcDay();
	seriesEndExclusive.setUTCDate(seriesEndExclusive.getUTCDate() + 1);
	const seriesStartInclusive = new Date(seriesEndExclusive);
	seriesStartInclusive.setUTCDate(seriesStartInclusive.getUTCDate() - DAILY_GENERATION_DAYS);

	const [
		userRows,
		projectCountRows,
		citationCountRows,
		requestRows,
		dailyRows,
		onboardingRows,
		academicRoleRows,
		discoveryRows,
		rmitRows,
		generationAuditRows
	] =
		await Promise.all([
			db
				.select({
					id: authUser.id,
					name: authUser.name,
					email: authUser.email,
					role: authUser.role,
					onboardingCompleted: authUser.onboardingCompleted,
					academicRole: authUser.academicRole,
					isFromRmit: authUser.isFromRmit,
					discoverySource: authUser.discoverySource,
					createdAt: authUser.createdAt
				})
				.from(authUser)
				.orderBy(desc(authUser.createdAt)),
			db
				.select({ userId: project.userId, count: sql<number>`count(*)` })
				.from(project)
				.groupBy(project.userId),
			db
				.select({ userId: project.userId, count: sql<number>`count(*)` })
				.from(citation)
				.innerJoin(project, eq(citation.projectId, project.id))
				.groupBy(project.userId),
			db
				.select({
					id: citationQuotaRequest.id,
					userId: citationQuotaRequest.userId,
					userName: authUser.name,
					userEmail: authUser.email,
					status: citationQuotaRequest.status,
					requestedWeeks: citationQuotaRequest.requestedWeeks,
					additionalPerWeek: citationQuotaRequest.additionalPerWeek,
					reason: citationQuotaRequest.reason,
					adminNote: citationQuotaRequest.adminNote,
					requestedAt: citationQuotaRequest.requestedAt,
					reviewedAt: citationQuotaRequest.reviewedAt,
					reviewerUserId: citationQuotaRequest.reviewerUserId
				})
				.from(citationQuotaRequest)
				.innerJoin(authUser, eq(citationQuotaRequest.userId, authUser.id))
				.orderBy(desc(citationQuotaRequest.requestedAt)),
			db
				.select({
					dayLabel: sql<string>`to_char(date_trunc('day', ${citationGenerationEvent.createdAt}), 'YYYY-MM-DD')`,
					count: sql<number>`coalesce(sum(${citationGenerationEvent.generatedCount}), 0)`
				})
				.from(citationGenerationEvent)
				.where(
					and(
						gte(citationGenerationEvent.createdAt, seriesStartInclusive),
						lt(citationGenerationEvent.createdAt, seriesEndExclusive)
					)
				)
				.groupBy(sql`date_trunc('day', ${citationGenerationEvent.createdAt})`)
				.orderBy(sql`date_trunc('day', ${citationGenerationEvent.createdAt}) asc`),
			db
				.select({ completed: authUser.onboardingCompleted, count: sql<number>`count(*)` })
				.from(authUser)
				.groupBy(authUser.onboardingCompleted),
			db
				.select({ label: authUser.academicRole, count: sql<number>`count(*)` })
				.from(authUser)
				.groupBy(authUser.academicRole)
				.orderBy(desc(sql<number>`count(*)`)),
			db
				.select({ label: authUser.discoverySource, count: sql<number>`count(*)` })
				.from(authUser)
				.groupBy(authUser.discoverySource)
				.orderBy(desc(sql<number>`count(*)`)),
			db
				.select({ isFromRmit: authUser.isFromRmit, count: sql<number>`count(*)` })
				.from(authUser)
				.groupBy(authUser.isFromRmit),
			db
				.select({
					eventId: citationGenerationEvent.id,
					createdAt: citationGenerationEvent.createdAt,
					actionType: citationGenerationEvent.actionType,
					metadata: citationGenerationEvent.metadata,
					generatedCount: citationGenerationEvent.generatedCount,
					userName: authUser.name,
					userEmail: authUser.email,
					projectId: project.id,
					projectName: project.name
				})
				.from(citationGenerationEvent)
				.innerJoin(authUser, eq(citationGenerationEvent.userId, authUser.id))
				.leftJoin(project, eq(citationGenerationEvent.projectId, project.id))
				.orderBy(desc(citationGenerationEvent.createdAt))
				.limit(300)
		]);

	const projectCountMap = new Map(projectCountRows.map((row) => [row.userId, Number(row.count)]));
	const citationCountMap = new Map(citationCountRows.map((row) => [row.userId, Number(row.count)]));

	const users = userRows.map((row) => ({
		id: row.id,
		name: row.name,
		email: row.email,
		role: row.role ?? 'user',
		onboardingCompleted: Boolean(row.onboardingCompleted),
		academicRole: row.academicRole || '',
		isFromRmit: Boolean(row.isFromRmit),
		discoverySource: row.discoverySource || '',
		projectCount: projectCountMap.get(row.id) ?? 0,
		citationCount: citationCountMap.get(row.id) ?? 0,
		createdAt: row.createdAt.toISOString()
	}));

	const pendingRequestCount = requestRows.filter((row) => row.status === 'pending').length;
	const adminCount = users.filter((user) => user.role === 'admin').length;
	const onboardingCompletedCount = users.filter((user) => user.onboardingCompleted).length;
	const totalProjects = projectCountRows.reduce((sum, row) => sum + Number(row.count), 0);
	const totalCitations = citationCountRows.reduce((sum, row) => sum + Number(row.count), 0);

	const dailyGenerationMap = new Map(dailyRows.map((row) => [row.dayLabel, Number(row.count)]));
	const weeklyGenerationSeries = Array.from({ length: DAILY_GENERATION_DAYS }, (_, index) => {
		const day = new Date(seriesStartInclusive);
		day.setUTCDate(seriesStartInclusive.getUTCDate() + index);
		const label = toIsoDate(day);

		return {
			label,
			value: dailyGenerationMap.get(label) ?? 0
		};
	});

	const openAiReviewRows = generationAuditRows.flatMap((eventRow) => {
		const parsed = parseCitationGenerationMetadata(eventRow.metadata);
		const items = parsed?.ai?.items;
		if (!Array.isArray(items) || items.length === 0) {
			return [];
		}

		return items.map((item, itemIndex) => ({
			id: `${eventRow.eventId}-${itemIndex + 1}`,
			eventId: eventRow.eventId,
			createdAt: eventRow.createdAt.toISOString(),
			actionType: eventRow.actionType,
			userName: eventRow.userName,
			userEmail: eventRow.userEmail,
			projectId: eventRow.projectId,
			projectName: eventRow.projectName || '(deleted project)',
			citationId: typeof item.citationId === 'number' ? item.citationId : null,
			style: toSafeString(parsed?.style),
			mode: toSafeString(parsed?.mode),
			fromStyle: toSafeString(parsed?.fromStyle),
			sourceName: toSafeString(item.sourceName),
			sourceType: toSafeString(item.sourceType),
			sourceText: toSafeString(item.sourceText),
			resolver: toSafeString(item.method),
			reason: toSafeString(item.reason),
			eventGeneratedCount: Number(eventRow.generatedCount)
		}));
	});

	return {
		admin: {
			id: event.locals.user.id,
			name: event.locals.user.name,
			email: event.locals.user.email,
			role: event.locals.user.role ?? 'admin'
		},
		metrics: {
			totalUsers: users.length,
			totalAdmins: adminCount,
			totalProjects,
			totalCitations,
			pendingRequestCount,
			onboardingCompletedCount
		},
		users,
		expansionRequests: requestRows.map((row) => ({
			id: row.id,
			userId: row.userId,
			userName: row.userName,
			userEmail: row.userEmail,
			status: row.status,
			requestedWeeks: row.requestedWeeks,
			additionalPerWeek: row.additionalPerWeek,
			reason: row.reason,
			adminNote: row.adminNote,
			requestedAt: row.requestedAt.toISOString(),
			reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
			reviewerUserId: row.reviewerUserId
		})),
		weeklyGenerationSeries,
		onboardingSummary: onboardingRows.map((row) => ({
			label: row.completed ? 'Completed' : 'Not Completed',
			value: Number(row.count)
		})),
		academicRoleSummary: academicRoleRows.map((row) => ({
			label: row.label && row.label.trim() ? row.label : 'Unspecified',
			value: Number(row.count)
		})),
		discoverySummary: discoveryRows.map((row) => ({
			label: row.label && row.label.trim() ? row.label : 'Unspecified',
			value: Number(row.count)
		})),
		rmitSummary: rmitRows.map((row) => ({
			label: row.isFromRmit ? 'RMIT' : 'Non-RMIT',
			value: Number(row.count)
		})),
		openAiReviewCount: openAiReviewRows.length,
		openAiReviewRows
	};
};

export const actions: Actions = {
	updateUserRole: async (event) => {
		if (!event.locals.user) {
			return redirect(302, '/auth');
		}

		if ((event.locals.user.role ?? 'user') !== 'admin') {
			return fail(403, { message: 'Admin access required.' });
		}

		const formData = await event.request.formData();
		const targetUserId = toValue(formData.get('userId'));
		const nextRole = toValue(formData.get('role'));
		if (!targetUserId || !allowedRoles.has(nextRole)) {
			return fail(400, { message: 'Invalid user role update payload.' });
		}

		if (targetUserId === event.locals.user.id && nextRole !== 'admin') {
			return fail(400, { message: 'You cannot remove your own admin role.' });
		}

		const [updated] = await db
			.update(authUser)
			.set({ role: nextRole, updatedAt: new Date() })
			.where(eq(authUser.id, targetUserId))
			.returning({ id: authUser.id });

		if (!updated) {
			return fail(404, { message: 'User not found.' });
		}

		return { message: 'User role updated.' };
	},
	approveExpansionRequest: async (event) => {
		if (!event.locals.user) {
			return redirect(302, '/auth');
		}

		if ((event.locals.user.role ?? 'user') !== 'admin') {
			return fail(403, { message: 'Admin access required.' });
		}

		const formData = await event.request.formData();
		const requestId = toInt(formData.get('requestId'));
		if (!requestId) {
			return fail(400, { message: 'Invalid expansion request.' });
		}

		try {
			const applied = await applyApprovedExpansionRequest({
				requestId,
				reviewerUserId: event.locals.user.id,
				adminNote: toValue(formData.get('adminNote'))
			});

			return {
				message: `Approved request. Applied ${applied.weeklyLimit} weekly limit for ${applied.appliedWeeks} week(s).`
			};
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : 'Failed to approve request.'
			});
		}
	},
	rejectExpansionRequest: async (event) => {
		if (!event.locals.user) {
			return redirect(302, '/auth');
		}

		if ((event.locals.user.role ?? 'user') !== 'admin') {
			return fail(403, { message: 'Admin access required.' });
		}

		const formData = await event.request.formData();
		const requestId = toInt(formData.get('requestId'));
		if (!requestId) {
			return fail(400, { message: 'Invalid expansion request.' });
		}

		try {
			await rejectExpansionRequest({
				requestId,
				reviewerUserId: event.locals.user.id,
				adminNote: toValue(formData.get('adminNote'))
			});
			return { message: 'Expansion request rejected.' };
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : 'Failed to reject request.'
			});
		}
	},
	signOut: async (event) => {
		await auth.api.signOut({
			headers: event.request.headers
		});

		return redirect(302, '/auth');
	}
};
