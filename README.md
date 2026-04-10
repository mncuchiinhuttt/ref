# Ref

Ref is a SvelteKit citation workspace focused on fast project-based reference generation, collaboration, and RMIT-ready workflows.

## Highlights

- Free citation workspace with team collaboration.
- Multi-style support: APA, MLA, Chicago, IEEE, and RMIT Harvard.
- Auto citation generation pipeline with metadata extraction and scholarly matching.
- Better Auth email/password authentication with OTP email verification.
- Onboarding survey flow with redirect guards.
- Admin panel for user analytics and quota request review.
- Weekly citation quota system with expansion requests.
- RMIT student bonus program for eligible domains (`rmit.edu.vn`, `rmit.edu.au`).

## Stack

- Svelte 5 + SvelteKit 2
- TypeScript
- Tailwind CSS 4 + shadcn-svelte + bits-ui
- Better Auth
- Drizzle ORM + Drizzle Kit
- Neon Postgres (`@neondatabase/serverless`)
- Resend (OTP email delivery)
- Semantic Scholar + OpenAI fallback for citation resolution

## Project Structure

```text
src/
	routes/
		+page.svelte                # Landing
		auth/                       # Login/register + OTP verification
		onboarding/                 # Survey flow
		dashboard/                  # User workspace
		dashboard/projects/[id]/    # Project citation workspace
		admin/                      # Admin analytics and moderation
	lib/
		components/                 # UI and page components
		server/
			auth.ts                   # Better Auth config
			onboarding.ts             # Onboarding guard helpers
			citations/                # Citation normalization + generation pipeline
			db/                       # Drizzle schema and DB client
docs/
	backend.md                    # Backend architecture and route/action docs
```

## Quick Start

### 1. Install

```sh
npm install
```

### 2. Configure environment

```sh
cp .env.example .env
```

Set at least:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `RESEND_API_KEY`
- `MODE` (`dev` by default)
- `BETTER_AUTH_URL` or `ORIGIN` (required in production)
- `SEMANTIC_SCHOLAR_API_KEY` (recommended)
- `OPENAI_API_KEY` (required when Semantic Scholar cannot resolve all sources)

### 3. Sync auth schema + database

```sh
npm run auth:schema
npm run db:push -- --force
```

Notes:

- After changing Better Auth additional fields in `src/lib/server/auth.ts`, run both commands again.
- `npm run db:migrate` / `npm run db:generate` are available if you prefer migration files.

### 4. Run dev server

```sh
npm run dev
```

## NPM Scripts

- `npm run dev` start development server
- `npm run build` production build
- `npm run preview` preview build
- `npm run check` Svelte + TypeScript diagnostics
- `npm run lint` Prettier check + ESLint
- `npm run format` apply formatting
- `npm run auth:schema` regenerate Better Auth schema file
- `npm run db:push` push schema to database
- `npm run db:studio` open Drizzle Studio

## Backend Summary

- Session and user are loaded in `hooks.server.ts` from Better Auth.
- Onboarding is enforced globally for authenticated users until survey completion.
- Most mutations are SvelteKit form actions (`+page.server.ts`), not REST endpoints.
- Citation generation flow:
	1. normalize input and extract metadata
	2. prioritize Semantic Scholar resolution
	3. apply deterministic formatter paths (including news heuristics)
	4. fallback to OpenAI for unresolved sources

See `docs/backend.md` for full backend documentation.

## Deployment Notes

- Ensure production `MODE=production` and set `BETTER_AUTH_URL` (or `ORIGIN`).
- Configure Postgres and email delivery before enabling real user signup.
- If citation generation is enabled in production, configure Semantic Scholar and OpenAI keys.

## License

Internal project. Add a license section if this repository becomes public.
