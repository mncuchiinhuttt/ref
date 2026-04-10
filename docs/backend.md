# Backend Documentation

This document describes the backend architecture, server flow, database model, and route actions for Ref.

## 1. Architecture Overview

Ref uses server-rendered SvelteKit pages with form actions as the primary backend interface.

- Runtime: Node-compatible SvelteKit server
- Auth/session: Better Auth
- Database: Postgres via Neon + Drizzle ORM
- Email: Resend (verification OTP)
- Citation engine:
  - metadata extraction and source normalization
  - Semantic Scholar priority resolution
  - rules-based formatters (including news heuristics)
  - OpenAI fallback for unresolved sources

No dedicated public REST API layer is defined for core product actions; mutations are handled through route actions in `+page.server.ts` files.

## 2. Request Lifecycle

Global request flow in `src/hooks.server.ts`:

1. Resolve current session via `auth.api.getSession`.
2. Populate `event.locals.session` and `event.locals.user` when authenticated.
3. Enforce onboarding guard:
   - authenticated users who need onboarding are redirected to `/onboarding`
   - users who completed onboarding are redirected away from `/onboarding` to `/dashboard`
4. Delegate to Better Auth SvelteKit handler.

## 3. Authentication and User Model

Auth configuration is in `src/lib/server/auth.ts`.

- Email/password auth enabled.
- Email verification required.
- OTP length: 5 digits.
- OTP expiry: 300 seconds.
- OTP delivery: Resend email service.
- Username plugin enabled.

User additional fields:

- `role` (`user` or `admin`)
- `onboardingCompleted`
- `academicRole`
- `isFromRmit`
- `discoverySource`

## 4. Database Model

Schema files:

- `src/lib/server/db/auth.schema.ts`
- `src/lib/server/db/schema.ts`

Core tables:

- `user`, `session`, `account`, `verification` (auth)
- `project` (owner and citation style)
- `citation` (generated entries per project)
- `project_member` (collaborators)
- `project_invitation` (pending/accepted/rejected invites)
- `citation_generation_event` (quota usage tracking)
- `citation_quota_request` (user request for temporary quota expansion)
- `citation_quota_override` (effective weekly limit overrides)

## 5. Quota System

Quota logic lives in `src/lib/server/citations/weekly-quota.ts`.

Defaults:

- Base user limit: 100/week
- Admin: unlimited

RMIT special program:

- Eligible domains: `rmit.edu.vn`, `rmit.edu.au`
- Eligible users can receive default 200/week (100 base + 100 bonus)
- Dashboard load can auto-enable `isFromRmit` when role is user and email domain is eligible

Expansion requests:

- Users can request additional weekly quota for a period of weeks
- Admin can approve/reject requests
- Approval creates/upserts rows in `citation_quota_override`

## 6. Citation Generation Pipeline

Primary entrypoint: `generateCitationsWithAI` in `src/lib/server/citations/generate-citations.ts`.

Pipeline order:

1. Build normalized source contexts via `source-metadata.ts`.
2. Attempt Semantic Scholar resolution first (`semantic-scholar.ts`).
3. Apply deterministic formatter for news/magazine sources (`rmit-news-formatter.ts`) when applicable.
4. For unresolved sources, fallback to OpenAI Responses API using strict JSON schema output.
5. Merge all resolved/fallback results into generated citations.

Important behavior:

- If unresolved sources remain and `OPENAI_API_KEY` is missing, generation fails explicitly.
- Warnings and missing fields are preserved to avoid fabricated metadata.

## 7. Server Routes and Actions

### Root (`/`)

File: `src/routes/+page.server.ts`

- `load`: returns current user (or null)
- action `signOut`

### Auth (`/auth`)

File: `src/routes/auth/+page.server.ts`

- `load`: redirect authenticated users to onboarding/dashboard
- action `signInEmail`
- action `signUpEmail`
- action `verifyEmailOtp`
- action `resendVerificationOtp`

### Onboarding (`/onboarding`)

File: `src/routes/onboarding/+page.server.ts`

- `load`: guard and optional prefill
- action `completeSurvey`
- action `signOut`

### Dashboard (`/dashboard`)

File: `src/routes/dashboard/+page.server.ts`

- `load`: projects, invitations, quota state, and RMIT bonus activation flag
- action `createProject`
- action `updateAccount`
- action `acceptInvitation`
- action `rejectInvitation`
- action `requestCitationExpansion`
- action `signOut`

### Project Workspace (`/dashboard/projects/[projectId]`)

File: `src/routes/dashboard/projects/[projectId]/+page.server.ts`

- `load`: project, collaborators, invites, citations, quota
- action `renameProject`
- action `updateCitationStyle`
- action `inviteMember`
- action `addCitations`
- action `editCitation`
- action `regenerateCitation`
- action `deleteCitation`
- action `deleteProject`
- action `requestCitationExpansion`
- action `signOut`

### Admin (`/admin`)

File: `src/routes/admin/+page.server.ts`

- `load`: metrics, user rollups, request queue, generation series
- action `updateUserRole`
- action `approveExpansionRequest`
- action `rejectExpansionRequest`
- action `signOut`

### Demo Auth Routes (`/demo/better-auth`)

Files:

- `src/routes/demo/better-auth/+page.server.ts`
- `src/routes/demo/better-auth/login/+page.server.ts`

Purpose: sandbox/demo Better Auth login flow.

## 8. Environment Variables

Defined in `.env.example` and consumed by backend modules:

- `DATABASE_URL`
- `MODE`
- `BETTER_AUTH_URL`
- `ORIGIN`
- `BETTER_AUTH_SECRET`
- `OPENAI_API_KEY`
- `SEMANTIC_SCHOLAR_API_KEY`
- `RESEND_API_KEY`

Also supported in Semantic Scholar module:

- `SEMANTICSCHOLAR_API_KEY`
- `S2_API_KEY`

## 9. Operational Runbook

Initial local setup:

```sh
npm install
cp .env.example .env
npm run auth:schema
npm run db:push -- --force
npm run dev
```

Validation:

```sh
npm run check
npm run lint
```

When editing Better Auth additional fields:

```sh
npm run auth:schema
npm run db:push -- --force
```

## 10. Extension Guidelines

- Keep business logic in `src/lib/server/**` helper modules where possible.
- Keep route actions thin and focused on validation + orchestration.
- Preserve deterministic behavior in citation formatters before relying on model fallback.
- For schema changes, keep Drizzle schema and Better Auth generated schema in sync.