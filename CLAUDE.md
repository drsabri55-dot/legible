# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

# Legible
A small business enters its website address, gets a free accessibility score (WCAG 2.1 AA; home page plus up to 5
navigation pages) and pays $99 for a full plain-English report (web page + PDF). The REPORT is the product, not the
scanner: when in doubt, make the report clearer rather than the scanner cleverer. Product brief: `../PROMPT-01-*.md`;
approved design and landing copy: `docs/superpowers/specs/2026-09-19-legible-design.md` (copy changes need the owner's OK).

## Commands
- `npm run setup` once (creates `.env.local` + `worker/.env`, installs worker + Chromium); `npm run dev` runs db, worker and site.
- `npm run lint` · `npm run typecheck` (runs `next typegen` first, which generates the global `PageProps`/`RouteContext` types, then checks the worker too)
- `npm test` (Vitest: unit + database tests against a throwaway embedded Postgres) · one file: `npx vitest run tests/unit/model.test.ts` · one test: `-t "name"`
- `npm --prefix worker test` (real Chromium scan of `tests/fixtures/site`) · `npm run test:e2e` (Playwright, builds the site) · one: `npx playwright test tests/e2e/landing.spec.ts -g "320px"`
- `npm run qa -- site.com other.com` scans real sites through the real scanner + report builder and prints what a customer sees.
- `npm --prefix worker run scan -- https://site.com --agent` runs one scan with the testing agent (needs `ANTHROPIC_API_KEY` in `worker/.env`); screenshots go to the system temp folder.
- `npm run db:migrate` applies `supabase/migrations/*.sql` to `DATABASE_URL`, tracked in `schema_migrations`.

## Architecture
Three processes: the Next.js site (Vercel), the scan worker (`worker/`, Railway via its Dockerfile), and Postgres. Only the site touches the database.
- **Scan:** `POST /api/scans` → `startScan` (`src/lib/scans.ts`: URL rules, block list, rate limits, DNS check) → `dispatchScan` → worker
  `/jobs/scan` (queue of 2) → `scanSite` → callbacks to `/api/worker/scans/[id]` (Bearer `WORKER_SECRET`) → `buildReport`/`freeSummary`
  → `scans.raw` + `scans.summary`. The result page polls `/api/scans/[id]` and refreshes.
- **Testing agent** (`worker/src/agent/`): after axe-core, `runAgentOnPage` measures keyboard traps, focus visibility, reflow at 320px,
  text spacing and unreachable clickable elements (`measure.ts`, no AI), then Claude (`AGENT_MODEL`, default `claude-sonnet-5-5`) uses
  the page by keyboard (`actions.ts`) behind `guard.ts` (no non-GET requests, no leaving the site). Claims count only when `measure.ts`
  confirms them; judgement findings need a second, independent model pass (`review.ts`) and go to "The agent's review", never the
  score. Results reuse `RawRule` ids `legible-*`; screenshots go to `scan_shots`. Runs only when a job sends `agent: true` and
  `ANTHROPIC_API_KEY` is set; `startScan` sends it while both prices are set and today's free spend is under
  `AGENT_DAILY_CAP_USD` (`src/lib/spend.ts`, `scans.agent` records on/capped/off). The worker meters every model call and its
  final message (complete or failed) is charged once into `agent_spend`. Tests use `ReplayModel`.
- **Reports are computed, never stored:** `buildReport(raw)` in `src/lib/report/model.ts` is pure; the report page and PDF rebuild from
  `scans.raw`. PDFs are rendered on demand by the worker's `/pdf`, which prints `/report/[token]?print=1` (only on `APP_URL`).
- **Payment:** `/api/checkout` → Stripe Checkout (or `/checkout/dev` when `ALLOW_FAKE_PAYMENTS=true` and no key). The webhook and
  `/scan/[id]/paid` both call `fulfil()`; `createReportOnce` (unique `scan_id`) makes it idempotent and only the creator sends the email.
- **Auth:** own magic links (`login_tokens` stores hashes; `/auth/verify` needs a button press) + HMAC-signed cookie (`src/lib/session.ts`).
  Links only go to existing customers or `ADMIN_EMAILS`. No Supabase Auth.
- **Database:** every query is in `src/lib/data.ts` (postgres.js, `prepare: false` for the Supabase pooler). RLS is on with no policies,
  so only the server connection reads; new migrations must enable RLS on new tables. Production project: Supabase `hcxakorfsotuvjyuwiqe`.
- **Kept in sync by hand:** `src/types/scan.ts` ↔ `worker/src/types.ts` (the scan contract) and `src/lib/net.ts` ↔ `worker/src/net.ts` (SSRF guard).
- **Report wording:** `src/lib/rules/catalogue.ts` (a test fails if any axe WCAG A/AA rule lacks an entry), auto-corrected code in
  `src/lib/rules/fixes.ts`. Emails: `emails/*.html`, first line `<!-- subject: … -->`, `{{var}}` escaped; no Resend key → `.data/outbox/`.
- **Landing page:** `src/app/page.tsx` renders every value in its final state; `src/lib/story/engine.ts` (port of the design's DCLogic,
  keyed on `data-a` attributes) rewinds and animates it. Keep its maths identical to `design/Legible Nocturne v2.dc.html`,
  apart from the owner-approved brightness constants at the top of engine.ts (`MOON_LIGHT` … `PHONE_INK`) and phone thinning (`PHONE_MAX`).
- **Styles:** Nocturne tokens on `:root` in `globals.css`, exposed to Tailwind as `nc-*`; base and component classes live in `@layer`
  so utilities win. Landing uses `landing.module.css`; the report uses `report.css` (`rp-` classes, A4 print and `@page` rules).

## Gotchas
- Worker `page.evaluate` must receive a string, not a function: tsx injects a `__name` helper the page doesn't have.
- `AxeBuilder.options()` replaces `withTags()`: pass `runOnly` inside `options`.
- `ALLOW_PRIVATE_TARGETS` (tests only) and `ALLOW_FAKE_PAYMENTS` are refused on Vercel. The worker prefers `WORKER_PORT` over `PORT`.
- E2E runs its own stack: Postgres 54331 (fresh each run), fixture site 5055, worker 4100, production build in `.next-e2e` on 3100.

## Legal phrasing (non-negotiable)
Never state or imply a site "is compliant" or "legally safe". Say it "identifies issues measured against WCAG 2.1 Level AA".
Disclaimer on the landing footer, result page, PDF cover and terms. Limitations page in every report. No overlay widget, ever.

## Coding rules
One job per change; explain the plan first when a change touches more than two files. Commit after every working step.
Write the test first where it makes sense. Never mix payment logic and product logic in one change.
Ask before guessing a product decision; design changes go in the owner's design doc for approval first.
Copy: British spelling, short specific sentences, no em-dash chains, no "not X, but Y" constructions.
