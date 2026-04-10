import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { and, asc, desc, eq, ilike, notInArray, or } from 'drizzle-orm';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import {
	citation,
	project,
	projectInvitation,
	projectMember,
	user as authUser
} from '$lib/server/db/schema';
import { CITATION_STYLES, generateCitationsWithAI } from '$lib/server/citations/generate-citations';
import { normalizeSourceTypeLabel } from '$lib/server/citations/source-metadata';
import {
	createExpansionRequest,
	DEFAULT_ADDITIONAL_PER_WEEK,
	ensureCanGenerateCitations,
	getCitationQuotaState,
	MAX_ADDITIONAL_PER_WEEK,
	MAX_EXPANSION_WEEKS,
	recordCitationGeneration
} from '$lib/server/citations/weekly-quota';

const toInt = (value: string | null | undefined): number | null => {
	if (!value) {
		return null;
	}

	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		return null;
	}

	return parsed;
};

const toValue = (value: FormDataEntryValue | null): string => value?.toString().trim() ?? '';

const isCitationStyle = (value: string): value is (typeof CITATION_STYLES)[number] => {
	return (CITATION_STYLES as readonly string[]).includes(value);
};

const quotaContextFromUser = (user: {
	id: string;
	role?: string | null;
	isFromRmit?: boolean | null;
	email?: string | null;
}) => ({
	userId: user.id,
	role: user.role ?? 'user',
	isFromRmit: user.isFromRmit ?? false,
	email: user.email ?? ''
});

const getProjectAccess = async (projectId: number, userId: string) => {
	const [projectRow] = await db
		.select({
			id: project.id,
			name: project.name,
			description: project.description,
			citationStyle: project.citationStyle,
			ownerId: project.userId,
			createdAt: project.createdAt,
			updatedAt: project.updatedAt,
			ownerName: authUser.name,
			ownerDisplayUsername: authUser.displayUsername,
			ownerUsername: authUser.username,
			ownerEmail: authUser.email,
			ownerImage: authUser.image
		})
		.from(project)
		.innerJoin(authUser, eq(project.userId, authUser.id))
		.where(eq(project.id, projectId))
		.limit(1);

	if (!projectRow) {
		return null;
	}

	if (projectRow.ownerId === userId) {
		return {
			project: projectRow,
			isOwner: true
		};
	}

	const [membership] = await db
		.select({ id: projectMember.id })
		.from(projectMember)
		.where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, userId)))
		.limit(1);

	if (!membership) {
		return null;
	}

	return {
		project: projectRow,
		isOwner: false
	};
};

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		return redirect(302, '/auth');
	}

	const projectId = toInt(event.params.projectId);
	if (!projectId) {
		error(404, 'Project not found.');
	}

	const access = await getProjectAccess(projectId, event.locals.user.id);
	if (!access) {
		error(404, 'Project not found.');
	}

	const collaboratorRows = await db
		.select({
			id: authUser.id,
			name: authUser.name,
			displayUsername: authUser.displayUsername,
			username: authUser.username,
			email: authUser.email,
			image: authUser.image,
			role: projectMember.role
		})
		.from(projectMember)
		.innerJoin(authUser, eq(projectMember.userId, authUser.id))
		.where(eq(projectMember.projectId, projectId))
		.orderBy(asc(authUser.name));

	const collaborators = [
		{
			id: access.project.ownerId,
			name: access.project.ownerName,
			displayUsername: access.project.ownerDisplayUsername,
			username: access.project.ownerUsername,
			email: access.project.ownerEmail,
			image: access.project.ownerImage,
			role: 'owner'
		}
	];

	for (const row of collaboratorRows) {
		if (!collaborators.some((item) => item.id === row.id)) {
			collaborators.push(row);
		}
	}

	const pendingInvitationRows = await db
		.select({
			id: projectInvitation.id,
			inviteeId: authUser.id,
			inviteeName: authUser.name,
			inviteeDisplayUsername: authUser.displayUsername,
			inviteeUsername: authUser.username,
			inviteeEmail: authUser.email,
			inviteeImage: authUser.image,
			createdAt: projectInvitation.createdAt
		})
		.from(projectInvitation)
		.innerJoin(authUser, eq(projectInvitation.inviteeUserId, authUser.id))
		.where(and(eq(projectInvitation.projectId, projectId), eq(projectInvitation.status, 'pending')))
		.orderBy(desc(projectInvitation.createdAt));

	const inviteQuery = event.url.searchParams.get('invite')?.trim() ?? '';
	let inviteSearchResults: Array<{
		id: string;
		name: string;
		displayUsername: string | null;
		username: string | null;
		email: string;
		image: string | null;
	}> = [];

	if (access.isOwner && inviteQuery.length >= 2) {
		const excludedUserIds = Array.from(
			new Set([
				...collaborators.map((item) => item.id),
				...pendingInvitationRows.map((item) => item.inviteeId)
			])
		);

		inviteSearchResults = await db
			.select({
				id: authUser.id,
				name: authUser.name,
				displayUsername: authUser.displayUsername,
				username: authUser.username,
				email: authUser.email,
				image: authUser.image
			})
			.from(authUser)
			.where(
				and(
					or(
						ilike(authUser.name, `%${inviteQuery}%`),
						ilike(authUser.displayUsername, `%${inviteQuery}%`),
						ilike(authUser.username, `%${inviteQuery}%`),
						ilike(authUser.email, `%${inviteQuery}%`)
					),
					notInArray(authUser.id, excludedUserIds)
				)
			)
			.orderBy(asc(authUser.name))
			.limit(10);
	}

	const citationRows = await db
		.select({
			id: citation.id,
			rawText: citation.rawText,
			title: citation.title,
			sourceType: citation.sourceType,
			inTextCitation: citation.inTextCitation,
			referenceCitation: citation.referenceCitation,
			style: citation.style,
			note: citation.note,
			createdAt: citation.createdAt
		})
		.from(citation)
		.where(eq(citation.projectId, projectId))
		.orderBy(desc(citation.createdAt));

	const citationQuota = await getCitationQuotaState(quotaContextFromUser(event.locals.user));

	return {
		user: {
			id: event.locals.user.id,
			email: event.locals.user.email,
			name: event.locals.user.name,
			image: event.locals.user.image,
			username: event.locals.user.username ?? null,
			displayUsername: event.locals.user.displayUsername ?? null,
			role: event.locals.user.role ?? 'user'
		},
		project: {
			id: access.project.id,
			name: access.project.name,
			description: access.project.description,
			citationStyle: access.project.citationStyle,
			isOwner: access.isOwner,
			createdAt: access.project.createdAt.toISOString(),
			updatedAt: access.project.updatedAt.toISOString()
		},
		citationQuota,
		collaborators,
		pendingInvitations: pendingInvitationRows.map((item) => ({
			id: item.id,
			invitee: {
				id: item.inviteeId,
				name: item.inviteeName,
				displayUsername: item.inviteeDisplayUsername,
				username: item.inviteeUsername,
				email: item.inviteeEmail,
				image: item.inviteeImage
			},
			createdAt: item.createdAt.toISOString()
		})),
		inviteQuery,
		inviteSearchResults,
		citationStyles: CITATION_STYLES,
		citations: citationRows.map((item) => ({
			id: item.id,
			rawText: item.rawText || item.title,
			sourceName: item.title || item.rawText,
			sourceType: normalizeSourceTypeLabel(item.sourceType),
			inTextCitation: item.inTextCitation || item.title,
			referenceCitation: item.referenceCitation || item.title,
			style: item.style,
			note: item.note,
			createdAt: item.createdAt.toISOString()
		}))
	};
};

export const actions: Actions = {
	renameProject: async (event) => {
		if (!event.locals.user) {
			return redirect(302, '/auth');
		}

		const projectId = toInt(event.params.projectId);
		if (!projectId) {
			return fail(400, { message: 'Invalid project.' });
		}

		const access = await getProjectAccess(projectId, event.locals.user.id);
		if (!access) {
			return fail(403, { message: 'Project access denied.' });
		}

		if (!access.isOwner) {
			return fail(403, { message: 'Only project owner can rename this project.' });
		}

		const formData = await event.request.formData();
		const projectName = toValue(formData.get('projectName'));
		if (!projectName) {
			return fail(400, { activeForm: 'rename', message: 'Project name is required.' });
		}

		if (projectName.length > 120) {
			return fail(400, {
				activeForm: 'rename',
				message: 'Project name must be 120 characters or less.'
			});
		}

		await db
			.update(project)
			.set({
				name: projectName,
				updatedAt: new Date()
			})
			.where(eq(project.id, projectId));

		return redirect(302, `/dashboard/projects/${projectId}`);
	},
	updateCitationStyle: async (event) => {
		if (!event.locals.user) {
			return redirect(302, '/auth');
		}

		const projectId = toInt(event.params.projectId);
		if (!projectId) {
			return fail(400, { message: 'Invalid project.' });
		}

		const access = await getProjectAccess(projectId, event.locals.user.id);
		if (!access) {
			return fail(403, { message: 'Project access denied.' });
		}

		if (!access.isOwner) {
			return fail(403, { message: 'Only project owner can change citation style.' });
		}

		const formData = await event.request.formData();
		const style = toValue(formData.get('citationStyle'));
		if (!isCitationStyle(style)) {
			return fail(400, { activeForm: 'style', message: 'Invalid citation style.' });
		}

		const styleUpdateMode = toValue(formData.get('styleUpdateMode'));
		const shouldRegenerateAll = styleUpdateMode === 'regenerate-all';

		if (!shouldRegenerateAll) {
			const citationQuota = await getCitationQuotaState(quotaContextFromUser(event.locals.user));

			await db
				.update(project)
				.set({
					citationStyle: style,
					updatedAt: new Date()
				})
				.where(eq(project.id, projectId));

			return {
				activeForm: 'style',
				citationStyle: style,
				regeneratedCount: 0,
				semanticScholarRetryCount: 0,
				citationQuota,
				message: 'Citation style updated.'
			};
		}

		const existingCitations = await db
			.select({
				id: citation.id,
				rawText: citation.rawText,
				title: citation.title,
				createdAt: citation.createdAt
			})
			.from(citation)
			.where(eq(citation.projectId, projectId))
			.orderBy(asc(citation.createdAt));

		const generationAllowance = await ensureCanGenerateCitations({
			...quotaContextFromUser(event.locals.user),
			requestedCount: existingCitations.length
		});

		if (!generationAllowance.allowed) {
			return fail(429, {
				activeForm: 'style',
				message: generationAllowance.message,
				citationQuota: generationAllowance.quota
			});
		}

		if (existingCitations.length === 0) {
			const citationQuota = await getCitationQuotaState(quotaContextFromUser(event.locals.user));

			await db
				.update(project)
				.set({
					citationStyle: style,
					updatedAt: new Date()
				})
				.where(eq(project.id, projectId));

			return {
				activeForm: 'style',
				citationStyle: style,
				regeneratedCount: 0,
				semanticScholarRetryCount: 0,
				citationQuota,
				message: 'Citation style updated. No citations found to re-generate.'
			};
		}

		const semanticScholarRetries: Array<{ attempt: number; reason: string }> = [];
		let regenerated;
		try {
			regenerated = await generateCitationsWithAI({
				style,
				sourceLines: existingCitations.map((item) => item.rawText || item.title),
				onSemanticScholarRetry: (retryEvent) => {
					semanticScholarRetries.push({
						attempt: retryEvent.attempt,
						reason: retryEvent.reason
					});
				}
			});
		} catch (error) {
			console.error('[project/updateCitationStyle] Citation re-generation failed', {
				projectId,
				citationCount: existingCitations.length,
				error
			});

			return fail(500, {
				activeForm: 'style',
				message:
					error instanceof Error
						? error.message
						: 'Citation re-generation failed unexpectedly.'
			});
		}

		const updatedAt = new Date();
		const regeneratedCitations = [] as Array<{
			id: number;
			rawText: string;
			title: string;
			sourceType: string;
			inTextCitation: string;
			referenceCitation: string;
			style: string;
			note: string | null;
			createdAt: Date;
		}>;

		for (const [index, currentCitation] of existingCitations.entries()) {
			const generatedCitation = regenerated[index];

			if (!generatedCitation) {
				await db
					.update(citation)
					.set({
						style,
						updatedAt
					})
					.where(and(eq(citation.id, currentCitation.id), eq(citation.projectId, projectId)));

				continue;
			}

			const [updatedCitation] = await db
				.update(citation)
				.set({
					title: generatedCitation.sourceName,
					sourceType: generatedCitation.sourceType,
					inTextCitation: generatedCitation.inTextCitation,
					referenceCitation: generatedCitation.referenceCitation,
					style,
					note:
						generatedCitation.plainExplanation ||
						(generatedCitation.warnings.length > 0 ? generatedCitation.warnings[0] : null),
					updatedAt
				})
				.where(and(eq(citation.id, currentCitation.id), eq(citation.projectId, projectId)))
				.returning({
					id: citation.id,
					rawText: citation.rawText,
					title: citation.title,
					sourceType: citation.sourceType,
					inTextCitation: citation.inTextCitation,
					referenceCitation: citation.referenceCitation,
					style: citation.style,
					note: citation.note,
					createdAt: citation.createdAt
				});

			if (updatedCitation) {
				regeneratedCitations.push(updatedCitation);
			}
		}

		await db
			.update(project)
			.set({
				citationStyle: style,
				updatedAt
			})
			.where(eq(project.id, projectId));

		await recordCitationGeneration({
			userId: event.locals.user.id,
			projectId,
			generatedCount: regeneratedCitations.length,
			actionType: 'regenerate-citations',
			metadata: `style=${style}`
		});

		const citationQuota = await getCitationQuotaState(quotaContextFromUser(event.locals.user));

		return {
			activeForm: 'style',
			citationStyle: style,
			regeneratedCount: regeneratedCitations.length,
			semanticScholarRetryCount: semanticScholarRetries.length,
			citationQuota,
			message: `Citation style updated and re-generated ${regeneratedCitations.length} citation${regeneratedCitations.length === 1 ? '' : 's'}.`,
			generatedCitations: regeneratedCitations.map((item) => ({
				id: item.id,
				rawText: item.rawText,
				sourceName: item.title,
				sourceType: normalizeSourceTypeLabel(item.sourceType),
				inTextCitation: item.inTextCitation,
				referenceCitation: item.referenceCitation,
				style: item.style,
				note: item.note,
				createdAt: item.createdAt.toISOString()
			}))
		};
	},
	inviteMember: async (event) => {
		if (!event.locals.user) {
			return redirect(302, '/auth');
		}

		const projectId = toInt(event.params.projectId);
		if (!projectId) {
			return fail(400, { message: 'Invalid project.' });
		}

		const access = await getProjectAccess(projectId, event.locals.user.id);
		if (!access || !access.isOwner) {
			return fail(403, { message: 'Only project owner can invite collaborators.' });
		}

		const inviteUserId = toValue((await event.request.formData()).get('inviteUserId'));
		if (!inviteUserId) {
			return fail(400, { activeForm: 'invite', message: 'Invalid invite target.' });
		}

		if (inviteUserId === event.locals.user.id) {
			return fail(400, { activeForm: 'invite', message: 'You are already in this project.' });
		}

		const [targetUser] = await db
			.select({ id: authUser.id })
			.from(authUser)
			.where(eq(authUser.id, inviteUserId))
			.limit(1);
		if (!targetUser) {
			return fail(404, { activeForm: 'invite', message: 'User not found.' });
		}

		const [existingMember] = await db
			.select({ id: projectMember.id })
			.from(projectMember)
			.where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, inviteUserId)))
			.limit(1);

		if (existingMember || inviteUserId === access.project.ownerId) {
			return fail(400, {
				activeForm: 'invite',
				message: 'User is already a collaborator on this project.'
			});
		}

		const [existingInvite] = await db
			.select({ id: projectInvitation.id })
			.from(projectInvitation)
			.where(
				and(
					eq(projectInvitation.projectId, projectId),
					eq(projectInvitation.inviteeUserId, inviteUserId),
					eq(projectInvitation.status, 'pending')
				)
			)
			.limit(1);

		if (existingInvite) {
			return fail(400, { activeForm: 'invite', message: 'Invitation already pending for this user.' });
		}

		await db.insert(projectInvitation).values({
			projectId,
			inviterUserId: event.locals.user.id,
			inviteeUserId: inviteUserId,
			status: 'pending'
		});

		return redirect(302, `/dashboard/projects/${projectId}`);
	},
	addCitations: async (event) => {
		if (!event.locals.user) {
			return redirect(302, '/auth');
		}

		const projectId = toInt(event.params.projectId);
		if (!projectId) {
			return fail(400, { message: 'Invalid project.' });
		}

		const access = await getProjectAccess(projectId, event.locals.user.id);
		if (!access) {
			return fail(403, { message: 'Project access denied.' });
		}

		const citationLinesRaw = toValue((await event.request.formData()).get('citationLines'));
		const sourceLines = citationLinesRaw
			.split(/\r?\n/)
			.map((item) => item.trim())
			.filter(Boolean);

		if (sourceLines.length === 0) {
			return fail(400, {
				activeForm: 'citations',
				citationLines: citationLinesRaw,
				message: 'Paste at least one citation source line.'
			});
		}

		if (sourceLines.length > 50) {
			return fail(400, {
				activeForm: 'citations',
				citationLines: citationLinesRaw,
				message: 'Please submit 50 lines or fewer at a time.'
			});
		}

		const generationAllowance = await ensureCanGenerateCitations({
			...quotaContextFromUser(event.locals.user),
			requestedCount: sourceLines.length
		});

		if (!generationAllowance.allowed) {
			return fail(429, {
				activeForm: 'citations',
				citationLines: citationLinesRaw,
				message: generationAllowance.message,
				citationQuota: generationAllowance.quota
			});
		}

		let generated;
		const semanticScholarRetries: Array<{ attempt: number; reason: string }> = [];
		try {
			generated = await generateCitationsWithAI({
				style: access.project.citationStyle,
				sourceLines,
				onSemanticScholarRetry: (retryEvent) => {
					semanticScholarRetries.push({
						attempt: retryEvent.attempt,
						reason: retryEvent.reason
					});
				}
			});
		} catch (error) {
			console.error('[project/addCitations] Citation generation failed', {
				projectId,
				sourceCount: sourceLines.length,
				error
			});

			return fail(500, {
				activeForm: 'citations',
				citationLines: citationLinesRaw,
				message:
					error instanceof Error
						? error.message
						: 'Citation generation failed unexpectedly.'
			});
		}

		const insertedRows = await db
			.insert(citation)
			.values(
			generated.map((item) => ({
				projectId,
				title: item.sourceName,
				rawText: item.sourceText,
				sourceType: item.sourceType,
				inTextCitation: item.inTextCitation,
				referenceCitation: item.referenceCitation,
				style: access.project.citationStyle,
				note:
					item.plainExplanation ||
					(item.warnings.length > 0 ? item.warnings[0] : null),
				updatedAt: new Date()
			}))
		)
			.returning({
				id: citation.id,
				rawText: citation.rawText,
				title: citation.title,
				sourceType: citation.sourceType,
				inTextCitation: citation.inTextCitation,
				referenceCitation: citation.referenceCitation,
				style: citation.style,
				note: citation.note,
				createdAt: citation.createdAt
			});

		await recordCitationGeneration({
			userId: event.locals.user.id,
			projectId,
			generatedCount: insertedRows.length,
			actionType: 'add-citations',
			metadata: `style=${access.project.citationStyle}`
		});

		const citationQuota = await getCitationQuotaState(quotaContextFromUser(event.locals.user));

		return {
			activeForm: 'citations',
			message: `Generated ${insertedRows.length} citation${insertedRows.length === 1 ? '' : 's'}.`,
			generatedCount: insertedRows.length,
			semanticScholarRetryCount: semanticScholarRetries.length,
			citationQuota,
			generatedCitations: insertedRows.map((item) => ({
				id: item.id,
				rawText: item.rawText,
				sourceName: item.title,
				sourceType: normalizeSourceTypeLabel(item.sourceType),
				inTextCitation: item.inTextCitation,
				referenceCitation: item.referenceCitation,
				style: item.style,
				note: item.note,
				createdAt: item.createdAt.toISOString()
			}))
		};
	},
	deleteProject: async (event) => {
		if (!event.locals.user) {
			return redirect(302, '/auth');
		}

		const projectId = toInt(event.params.projectId);
		if (!projectId) {
			return fail(400, { message: 'Invalid project.' });
		}

		const access = await getProjectAccess(projectId, event.locals.user.id);
		if (!access) {
			return fail(403, { message: 'Project access denied.' });
		}

		if (!access.isOwner) {
			return fail(403, { message: 'Only project owner can delete this project.' });
		}

		const [deletedProject] = await db
			.delete(project)
			.where(and(eq(project.id, projectId), eq(project.userId, event.locals.user.id)))
			.returning({ id: project.id });

		if (!deletedProject) {
			return fail(404, { message: 'Project not found.' });
		}

		return redirect(302, '/dashboard');
	},
	editCitation: async (event) => {
		if (!event.locals.user) {
			return redirect(302, '/auth');
		}

		const projectId = toInt(event.params.projectId);
		if (!projectId) {
			return fail(400, { message: 'Invalid project.' });
		}

		const access = await getProjectAccess(projectId, event.locals.user.id);
		if (!access) {
			return fail(403, { message: 'Project access denied.' });
		}

		const formData = await event.request.formData();
		const citationId = toInt(toValue(formData.get('citationId')));
		if (!citationId) {
			return fail(400, { activeForm: 'editCitation', message: 'Invalid citation.' });
		}

		const sourceName = toValue(formData.get('sourceName'));
		const sourceTypeInput = toValue(formData.get('sourceType'));
		const inTextCitationValue = toValue(formData.get('inTextCitation'));
		const referenceCitationValue = toValue(formData.get('referenceCitation'));
		const noteValue = toValue(formData.get('note'));

		if (!sourceName) {
			return fail(400, {
				activeForm: 'editCitation',
				message: 'Citation name is required.'
			});
		}

		if (!inTextCitationValue) {
			return fail(400, {
				activeForm: 'editCitation',
				message: 'In-text citation is required.'
			});
		}

		if (!referenceCitationValue) {
			return fail(400, {
				activeForm: 'editCitation',
				message: 'Reference citation is required.'
			});
		}

		const normalizedSourceType = normalizeSourceTypeLabel(sourceTypeInput || 'Websites & Webpage');

		const [updatedCitation] = await db
			.update(citation)
			.set({
				title: sourceName,
				sourceType: normalizedSourceType,
				inTextCitation: inTextCitationValue,
				referenceCitation: referenceCitationValue,
				note: noteValue || null,
				updatedAt: new Date()
			})
			.where(and(eq(citation.id, citationId), eq(citation.projectId, projectId)))
			.returning({
				id: citation.id,
				rawText: citation.rawText,
				title: citation.title,
				sourceType: citation.sourceType,
				inTextCitation: citation.inTextCitation,
				referenceCitation: citation.referenceCitation,
				style: citation.style,
				note: citation.note,
				createdAt: citation.createdAt
			});

		if (!updatedCitation) {
			return fail(404, { activeForm: 'editCitation', message: 'Citation not found.' });
		}

		return {
			activeForm: 'editCitation',
			message: 'Citation updated.',
			updatedCitation: {
				id: updatedCitation.id,
				rawText: updatedCitation.rawText,
				sourceName: updatedCitation.title,
				sourceType: normalizeSourceTypeLabel(updatedCitation.sourceType),
				inTextCitation: updatedCitation.inTextCitation,
				referenceCitation: updatedCitation.referenceCitation,
				style: updatedCitation.style,
				note: updatedCitation.note,
				createdAt: updatedCitation.createdAt.toISOString()
			}
		};
	},
	regenerateCitation: async (event) => {
		if (!event.locals.user) {
			return redirect(302, '/auth');
		}

		const projectId = toInt(event.params.projectId);
		if (!projectId) {
			return fail(400, { message: 'Invalid project.' });
		}

		const access = await getProjectAccess(projectId, event.locals.user.id);
		if (!access) {
			return fail(403, { message: 'Project access denied.' });
		}

		const citationId = toInt(toValue((await event.request.formData()).get('citationId')));
		if (!citationId) {
			return fail(400, { activeForm: 'regenerateCitation', message: 'Invalid citation.' });
		}

		const [existingCitation] = await db
			.select({
				id: citation.id,
				rawText: citation.rawText,
				title: citation.title
			})
			.from(citation)
			.where(and(eq(citation.id, citationId), eq(citation.projectId, projectId)))
			.limit(1);

		if (!existingCitation) {
			return fail(404, { activeForm: 'regenerateCitation', message: 'Citation not found.' });
		}

		const generationAllowance = await ensureCanGenerateCitations({
			...quotaContextFromUser(event.locals.user),
			requestedCount: 1
		});

		if (!generationAllowance.allowed) {
			return fail(429, {
				activeForm: 'regenerateCitation',
				message: generationAllowance.message,
				citationQuota: generationAllowance.quota
			});
		}

		let generated;
		const semanticScholarRetries: Array<{ attempt: number; reason: string }> = [];
		try {
			generated = await generateCitationsWithAI({
				style: access.project.citationStyle,
				sourceLines: [existingCitation.rawText || existingCitation.title],
				onSemanticScholarRetry: (retryEvent) => {
					semanticScholarRetries.push({
						attempt: retryEvent.attempt,
						reason: retryEvent.reason
					});
				}
			});
		} catch (error) {
			console.error('[project/regenerateCitation] Citation regeneration failed', {
				projectId,
				citationId,
				error
			});

			return fail(500, {
				activeForm: 'regenerateCitation',
				message:
					error instanceof Error
						? error.message
						: 'Citation regeneration failed unexpectedly.'
			});
		}

		const regeneratedCitation = generated[0];
		if (!regeneratedCitation) {
			return fail(500, {
				activeForm: 'regenerateCitation',
				message: 'Citation regeneration did not return a valid result.'
			});
		}

		const [updatedCitation] = await db
			.update(citation)
			.set({
				title: regeneratedCitation.sourceName,
				sourceType: regeneratedCitation.sourceType,
				inTextCitation: regeneratedCitation.inTextCitation,
				referenceCitation: regeneratedCitation.referenceCitation,
				style: access.project.citationStyle,
				note:
					regeneratedCitation.plainExplanation ||
					(regeneratedCitation.warnings.length > 0 ? regeneratedCitation.warnings[0] : null),
				updatedAt: new Date()
			})
			.where(and(eq(citation.id, citationId), eq(citation.projectId, projectId)))
			.returning({
				id: citation.id,
				rawText: citation.rawText,
				title: citation.title,
				sourceType: citation.sourceType,
				inTextCitation: citation.inTextCitation,
				referenceCitation: citation.referenceCitation,
				style: citation.style,
				note: citation.note,
				createdAt: citation.createdAt
			});

		if (!updatedCitation) {
			return fail(404, { activeForm: 'regenerateCitation', message: 'Citation not found.' });
		}

		await recordCitationGeneration({
			userId: event.locals.user.id,
			projectId,
			generatedCount: 1,
			actionType: 'regenerate-citations',
			metadata: `citationId=${citationId};style=${access.project.citationStyle}`
		});

		const citationQuota = await getCitationQuotaState(quotaContextFromUser(event.locals.user));

		return {
			activeForm: 'regenerateCitation',
			semanticScholarRetryCount: semanticScholarRetries.length,
			citationQuota,
			message: 'Citation re-generated.',
			updatedCitation: {
				id: updatedCitation.id,
				rawText: updatedCitation.rawText,
				sourceName: updatedCitation.title,
				sourceType: normalizeSourceTypeLabel(updatedCitation.sourceType),
				inTextCitation: updatedCitation.inTextCitation,
				referenceCitation: updatedCitation.referenceCitation,
				style: updatedCitation.style,
				note: updatedCitation.note,
				createdAt: updatedCitation.createdAt.toISOString()
			}
		};
	},
	requestCitationExpansion: async (event) => {
		if (!event.locals.user) {
			return redirect(302, '/auth');
		}

		if ((event.locals.user.role ?? 'user') !== 'user') {
			return fail(403, {
				activeForm: 'requestCitationExpansion',
				message: 'Only users can request weekly citation expansion.'
			});
		}

		const formData = await event.request.formData();
		const requestedWeeksRaw = toInt(toValue(formData.get('requestedWeeks')));
		const additionalPerWeekRaw = toInt(toValue(formData.get('additionalPerWeek')));
		const reason = toValue(formData.get('reason'));

		const requestResult = await createExpansionRequest({
			userId: event.locals.user.id,
			requestedWeeks:
				requestedWeeksRaw && requestedWeeksRaw > 0
					? Math.min(MAX_EXPANSION_WEEKS, requestedWeeksRaw)
					: 1,
			additionalPerWeek:
				additionalPerWeekRaw && additionalPerWeekRaw > 0
					? Math.min(MAX_ADDITIONAL_PER_WEEK, additionalPerWeekRaw)
					: DEFAULT_ADDITIONAL_PER_WEEK,
			reason
		});

		return {
			activeForm: 'requestCitationExpansion',
			message: requestResult.message
		};
	},
	deleteCitation: async (event) => {
		if (!event.locals.user) {
			return redirect(302, '/auth');
		}

		const projectId = toInt(event.params.projectId);
		if (!projectId) {
			return fail(400, { message: 'Invalid project.' });
		}

		const access = await getProjectAccess(projectId, event.locals.user.id);
		if (!access) {
			return fail(403, { message: 'Project access denied.' });
		}

		const citationId = toInt(toValue((await event.request.formData()).get('citationId')));
		if (!citationId) {
			return fail(400, { activeForm: 'deleteCitation', message: 'Invalid citation.' });
		}

		const [deleted] = await db
			.delete(citation)
			.where(and(eq(citation.id, citationId), eq(citation.projectId, projectId)))
			.returning({ id: citation.id });

		if (!deleted) {
			return fail(404, { activeForm: 'deleteCitation', message: 'Citation not found.' });
		}

		return {
			activeForm: 'deleteCitation',
			message: 'Citation deleted.',
			citationId: deleted.id
		};
	},
	signOut: async (event) => {
		await auth.api.signOut({
			headers: event.request.headers
		});

		return redirect(302, '/auth');
	}
};
