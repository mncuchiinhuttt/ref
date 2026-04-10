import { relations } from 'drizzle-orm';
import { pgTable, serial, integer, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './auth.schema';

export const task = pgTable('task', {
	id: serial('id').primaryKey(),
	title: text('title').notNull(),
	priority: integer('priority').notNull().default(1)
});

export const project = pgTable(
	'project',
	{
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		citationStyle: text('citation_style').notNull().default('APA'),
		description: text('description'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [index('project_user_id_idx').on(table.userId)]
);

export const citation = pgTable(
	'citation',
	{
		id: serial('id').primaryKey(),
		projectId: integer('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		rawText: text('raw_text').notNull().default(''),
		inTextCitation: text('in_text_citation').notNull().default(''),
		referenceCitation: text('reference_citation').notNull().default(''),
		sourceType: text('source_type').notNull().default('Websites & Webpage'),
		sourceUrl: text('source_url'),
		author: text('author'),
		publishedYear: integer('published_year'),
		style: text('style').notNull().default('APA'),
		note: text('note'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [index('citation_project_id_idx').on(table.projectId)]
);

export const citationQuotaRequest = pgTable(
	'citation_quota_request',
	{
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		requestedWeeks: integer('requested_weeks').notNull().default(1),
		additionalPerWeek: integer('additional_per_week').notNull().default(50),
		reason: text('reason'),
		status: text('status').notNull().default('pending'),
		adminNote: text('admin_note'),
		reviewerUserId: text('reviewer_user_id').references(() => user.id, { onDelete: 'set null' }),
		requestedAt: timestamp('requested_at').defaultNow().notNull(),
		reviewedAt: timestamp('reviewed_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [
		index('citation_quota_request_user_id_idx').on(table.userId),
		index('citation_quota_request_status_idx').on(table.status),
		index('citation_quota_request_requested_at_idx').on(table.requestedAt)
	]
);

export const citationQuotaOverride = pgTable(
	'citation_quota_override',
	{
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		weekStart: timestamp('week_start').notNull(),
		weekEnd: timestamp('week_end').notNull(),
		weeklyLimit: integer('weekly_limit').notNull().default(100),
		requestId: integer('request_id').references(() => citationQuotaRequest.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [
		index('citation_quota_override_user_id_idx').on(table.userId),
		index('citation_quota_override_week_start_idx').on(table.weekStart),
		uniqueIndex('citation_quota_override_user_week_unique').on(table.userId, table.weekStart)
	]
);

export const citationGenerationEvent = pgTable(
	'citation_generation_event',
	{
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		projectId: integer('project_id').references(() => project.id, { onDelete: 'set null' }),
		generatedCount: integer('generated_count').notNull().default(0),
		actionType: text('action_type').notNull().default('generate'),
		metadata: text('metadata'),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(table) => [
		index('citation_generation_event_user_id_idx').on(table.userId),
		index('citation_generation_event_created_at_idx').on(table.createdAt),
		index('citation_generation_event_project_id_idx').on(table.projectId)
	]
);

export const projectMember = pgTable(
	'project_member',
	{
		id: serial('id').primaryKey(),
		projectId: integer('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		role: text('role').notNull().default('member'),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(table) => [
		index('project_member_project_id_idx').on(table.projectId),
		index('project_member_user_id_idx').on(table.userId),
		uniqueIndex('project_member_project_user_unique').on(table.projectId, table.userId)
	]
);

export const projectInvitation = pgTable(
	'project_invitation',
	{
		id: serial('id').primaryKey(),
		projectId: integer('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		inviterUserId: text('inviter_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		inviteeUserId: text('invitee_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		status: text('status').notNull().default('pending'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		respondedAt: timestamp('responded_at')
	},
	(table) => [
		index('project_invitation_project_id_idx').on(table.projectId),
		index('project_invitation_invitee_user_id_idx').on(table.inviteeUserId),
		index('project_invitation_status_idx').on(table.status)
	]
);

export const projectRelations = relations(project, ({ one, many }) => ({
	user: one(user, {
		fields: [project.userId],
		references: [user.id]
	}),
	citations: many(citation),
	members: many(projectMember),
	invitations: many(projectInvitation)
}));

export const citationRelations = relations(citation, ({ one }) => ({
	project: one(project, {
		fields: [citation.projectId],
		references: [project.id]
	})
}));

export const citationQuotaRequestRelations = relations(citationQuotaRequest, ({ one }) => ({
	user: one(user, {
		fields: [citationQuotaRequest.userId],
		references: [user.id]
	}),
	reviewer: one(user, {
		fields: [citationQuotaRequest.reviewerUserId],
		references: [user.id]
	})
}));

export const citationQuotaOverrideRelations = relations(citationQuotaOverride, ({ one }) => ({
	user: one(user, {
		fields: [citationQuotaOverride.userId],
		references: [user.id]
	}),
	request: one(citationQuotaRequest, {
		fields: [citationQuotaOverride.requestId],
		references: [citationQuotaRequest.id]
	})
}));

export const citationGenerationEventRelations = relations(citationGenerationEvent, ({ one }) => ({
	user: one(user, {
		fields: [citationGenerationEvent.userId],
		references: [user.id]
	}),
	project: one(project, {
		fields: [citationGenerationEvent.projectId],
		references: [project.id]
	})
}));

export const projectMemberRelations = relations(projectMember, ({ one }) => ({
	project: one(project, {
		fields: [projectMember.projectId],
		references: [project.id]
	}),
	user: one(user, {
		fields: [projectMember.userId],
		references: [user.id]
	})
}));

export const projectInvitationRelations = relations(projectInvitation, ({ one }) => ({
	project: one(project, {
		fields: [projectInvitation.projectId],
		references: [project.id]
	}),
	inviter: one(user, {
		fields: [projectInvitation.inviterUserId],
		references: [user.id]
	}),
	invitee: one(user, {
		fields: [projectInvitation.inviteeUserId],
		references: [user.id]
	})
}));

export * from './auth.schema';
