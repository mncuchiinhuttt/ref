import { and, desc, eq, gt, gte, lt, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	citationGenerationEvent,
	citationQuotaOverride,
	citationQuotaRequest,
	user as authUser
} from '$lib/server/db/schema';

export const BASE_WEEKLY_CITATION_LIMIT = 100;
export const RMIT_STUDENT_WEEKLY_CITATION_LIMIT = 200;
export const MAX_EXPANSION_WEEKS = 12;
export const MAX_ADDITIONAL_PER_WEEK = 1_000;
export const DEFAULT_ADDITIONAL_PER_WEEK = 100;

const RMIT_EMAIL_DOMAINS = new Set(['rmit.edu.vn', 'rmit.edu.au']);

export type CitationQuotaState = {
	isLimited: boolean;
	weeklyLimit: number | null;
	usedThisWeek: number;
	remainingThisWeek: number | null;
	weekStartIso: string;
	weekEndIso: string;
	activeOverride: {
		id: number;
		weeklyLimit: number;
		requestId: number | null;
	} | null;
	pendingRequestCount: number;
};

const toInt = (value: unknown, fallback: number): number => {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.trunc(value);
	}

	if (typeof value === 'string' && value.trim()) {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}

	return fallback;
};

const weekStartUtc = (date: Date): Date => {
	const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
	const day = start.getUTCDay();
	const delta = day === 0 ? -6 : 1 - day;
	start.setUTCDate(start.getUTCDate() + delta);
	start.setUTCHours(0, 0, 0, 0);
	return start;
};

const toEmailDomain = (email: string | null | undefined): string => {
	const normalized = email?.trim().toLowerCase() ?? '';
	if (!normalized || !normalized.includes('@')) {
		return '';
	}

	const atIndex = normalized.lastIndexOf('@');
	return atIndex >= 0 ? normalized.slice(atIndex + 1) : '';
};

export const hasRmitEmailDomain = (email: string | null | undefined): boolean =>
	RMIT_EMAIL_DOMAINS.has(toEmailDomain(email));

const resolveBaseWeeklyLimit = (args: {
	isFromRmit?: boolean | null;
	email?: string | null;
}): number => {
	if (args.isFromRmit && hasRmitEmailDomain(args.email)) {
		return RMIT_STUDENT_WEEKLY_CITATION_LIMIT;
	}

	return BASE_WEEKLY_CITATION_LIMIT;
};

export const getWeekWindowUtc = (date = new Date(), weekOffset = 0): { weekStart: Date; weekEnd: Date } => {
	const weekStart = weekStartUtc(date);
	weekStart.setUTCDate(weekStart.getUTCDate() + weekOffset * 7);
	const weekEnd = new Date(weekStart);
	weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
	return { weekStart, weekEnd };
};

const getPendingRequestCount = async (userId: string): Promise<number> => {
	const [row] = await db
		.select({ count: sql<number>`count(*)` })
		.from(citationQuotaRequest)
		.where(and(eq(citationQuotaRequest.userId, userId), eq(citationQuotaRequest.status, 'pending')));

	return toInt(row?.count, 0);
};

export const getCitationQuotaState = async (args: {
	userId: string;
	role: string;
	isFromRmit?: boolean | null;
	email?: string | null;
	now?: Date;
}): Promise<CitationQuotaState> => {
	const now = args.now ?? new Date();
	const { weekStart, weekEnd } = getWeekWindowUtc(now);
	const isLimited = args.role === 'user';
	const baseWeeklyLimit = resolveBaseWeeklyLimit({
		isFromRmit: args.isFromRmit,
		email: args.email
	});

	const [usageRows, pendingRequestCount] = await Promise.all([
		db
			.select({
				total: sql<number>`coalesce(sum(${citationGenerationEvent.generatedCount}), 0)`
			})
			.from(citationGenerationEvent)
			.where(
				and(
					eq(citationGenerationEvent.userId, args.userId),
					gte(citationGenerationEvent.createdAt, weekStart),
					lt(citationGenerationEvent.createdAt, weekEnd)
				)
			),
		isLimited ? getPendingRequestCount(args.userId) : Promise.resolve(0)
	]);

	const usedThisWeek = toInt(usageRows[0]?.total, 0);
	if (!isLimited) {
		return {
			isLimited: false,
			weeklyLimit: null,
			usedThisWeek,
			remainingThisWeek: null,
			weekStartIso: weekStart.toISOString(),
			weekEndIso: weekEnd.toISOString(),
			activeOverride: null,
			pendingRequestCount
		};
	}

	const [activeOverride] = await db
		.select({
			id: citationQuotaOverride.id,
			weeklyLimit: citationQuotaOverride.weeklyLimit,
			requestId: citationQuotaOverride.requestId
		})
		.from(citationQuotaOverride)
		.where(
			and(
				eq(citationQuotaOverride.userId, args.userId),
				lte(citationQuotaOverride.weekStart, now),
				gt(citationQuotaOverride.weekEnd, now)
			)
		)
		.orderBy(desc(citationQuotaOverride.weeklyLimit))
		.limit(1);

	const weeklyLimit = toInt(activeOverride?.weeklyLimit, baseWeeklyLimit);
	const remainingThisWeek = Math.max(0, weeklyLimit - usedThisWeek);

	return {
		isLimited: true,
		weeklyLimit,
		usedThisWeek,
		remainingThisWeek,
		weekStartIso: weekStart.toISOString(),
		weekEndIso: weekEnd.toISOString(),
		activeOverride: activeOverride
			? {
				id: activeOverride.id,
				weeklyLimit,
				requestId: activeOverride.requestId
			}
			: null,
		pendingRequestCount
	};
};

export const ensureCanGenerateCitations = async (args: {
	userId: string;
	role: string;
	isFromRmit?: boolean | null;
	email?: string | null;
	requestedCount: number;
}): Promise<{ allowed: boolean; message: string; quota: CitationQuotaState }> => {
	const quota = await getCitationQuotaState({
		userId: args.userId,
		role: args.role,
		isFromRmit: args.isFromRmit,
		email: args.email
	});
	if (!quota.isLimited) {
		return {
			allowed: true,
			message: '',
			quota
		};
	}

	const requestedCount = Math.max(0, Math.trunc(args.requestedCount));
	if (requestedCount <= (quota.remainingThisWeek ?? 0)) {
		return {
			allowed: true,
			message: '',
			quota
		};
	}

	const remaining = quota.remainingThisWeek ?? 0;
	const effectiveLimit = quota.weeklyLimit ?? resolveBaseWeeklyLimit(args);
	return {
		allowed: false,
		message:
			remaining <= 0
				? `Weekly citation generation limit reached (${effectiveLimit}/week for user role unless expanded).`
				: `Weekly citation generation limit exceeded. Remaining this week: ${remaining}.`,
		quota
	};
};

export const recordCitationGeneration = async (args: {
	userId: string;
	projectId: number | null;
	generatedCount: number;
	actionType: 'add-citations' | 'regenerate-citations';
	metadata?: string;
}): Promise<void> => {
	const generatedCount = Math.max(0, Math.trunc(args.generatedCount));
	if (generatedCount <= 0) {
		return;
	}

	await db.insert(citationGenerationEvent).values({
		userId: args.userId,
		projectId: args.projectId,
		generatedCount,
		actionType: args.actionType,
		metadata: args.metadata ?? null
	});
};

export const createExpansionRequest = async (args: {
	userId: string;
	requestedWeeks: number;
	additionalPerWeek: number;
	reason: string;
}): Promise<{ id: number; message: string }> => {
	const requestedWeeks = Math.max(1, Math.min(MAX_EXPANSION_WEEKS, Math.trunc(args.requestedWeeks)));
	const additionalPerWeek = Math.max(
		1,
		Math.min(MAX_ADDITIONAL_PER_WEEK, Math.trunc(args.additionalPerWeek))
	);

	const [existingPending] = await db
		.select({ id: citationQuotaRequest.id })
		.from(citationQuotaRequest)
		.where(and(eq(citationQuotaRequest.userId, args.userId), eq(citationQuotaRequest.status, 'pending')))
		.limit(1);

	if (existingPending) {
		return {
			id: existingPending.id,
			message: 'A citation expansion request is already pending review.'
		};
	}

	const [created] = await db
		.insert(citationQuotaRequest)
		.values({
			userId: args.userId,
			requestedWeeks,
			additionalPerWeek,
			reason: args.reason || null,
			status: 'pending',
			requestedAt: new Date(),
			updatedAt: new Date()
		})
		.returning({ id: citationQuotaRequest.id });

	return {
		id: created.id,
		message: 'Citation expansion request submitted for admin review.'
	};
};

export const applyApprovedExpansionRequest = async (args: {
	requestId: number;
	reviewerUserId: string;
	adminNote?: string;
}): Promise<{ appliedWeeks: number; weeklyLimit: number; userId: string }> => {
	const [requestRow] = await db
		.select({
			id: citationQuotaRequest.id,
			userId: citationQuotaRequest.userId,
			status: citationQuotaRequest.status,
			requestedWeeks: citationQuotaRequest.requestedWeeks,
			additionalPerWeek: citationQuotaRequest.additionalPerWeek
		})
		.from(citationQuotaRequest)
		.where(eq(citationQuotaRequest.id, args.requestId))
		.limit(1);

	if (!requestRow) {
		throw new Error('Citation expansion request not found.');
	}

	if (requestRow.status !== 'pending') {
		throw new Error('Citation expansion request has already been reviewed.');
	}

	const requestedWeeks = Math.max(1, Math.min(MAX_EXPANSION_WEEKS, requestRow.requestedWeeks));
	const [requestingUser] = await db
		.select({
			isFromRmit: authUser.isFromRmit,
			email: authUser.email
		})
		.from(authUser)
		.where(eq(authUser.id, requestRow.userId))
		.limit(1);

	const baseWeeklyLimit = resolveBaseWeeklyLimit({
		isFromRmit: requestingUser?.isFromRmit,
		email: requestingUser?.email
	});

	const weeklyLimit =
		baseWeeklyLimit +
		Math.max(1, Math.min(MAX_ADDITIONAL_PER_WEEK, requestRow.additionalPerWeek));
	const now = new Date();

	for (let offset = 0; offset < requestedWeeks; offset += 1) {
		const { weekStart, weekEnd } = getWeekWindowUtc(now, offset);
		await db
			.insert(citationQuotaOverride)
			.values({
				userId: requestRow.userId,
				weekStart,
				weekEnd,
				weeklyLimit,
				requestId: requestRow.id,
				updatedAt: now
			})
			.onConflictDoUpdate({
				target: [citationQuotaOverride.userId, citationQuotaOverride.weekStart],
				set: {
					weekEnd,
					weeklyLimit,
					requestId: requestRow.id,
					updatedAt: now
				}
			});
	}

	await db
		.update(citationQuotaRequest)
		.set({
			status: 'approved',
			reviewerUserId: args.reviewerUserId,
			adminNote: args.adminNote || null,
			reviewedAt: now,
			updatedAt: now
		})
		.where(eq(citationQuotaRequest.id, requestRow.id));

	return {
		appliedWeeks: requestedWeeks,
		weeklyLimit,
		userId: requestRow.userId
	};
};

export const rejectExpansionRequest = async (args: {
	requestId: number;
	reviewerUserId: string;
	adminNote?: string;
}): Promise<void> => {
	const now = new Date();
	const [updated] = await db
		.update(citationQuotaRequest)
		.set({
			status: 'rejected',
			reviewerUserId: args.reviewerUserId,
			adminNote: args.adminNote || null,
			reviewedAt: now,
			updatedAt: now
		})
		.where(and(eq(citationQuotaRequest.id, args.requestId), eq(citationQuotaRequest.status, 'pending')))
		.returning({ id: citationQuotaRequest.id });

	if (!updated) {
		throw new Error('Citation expansion request not found or already reviewed.');
	}
};
