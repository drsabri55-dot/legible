# Testing agent phase 4: whole-site paid testing. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After payment, the worker tests the rest of the site (up to 50 pages in all) with axe-core, the agent and tested fixes; the report fills in as pages arrive, stops at $15 of AI spend, resumes after a restart, and emails the finished report with the PDF.

**Architecture:** `deliverReport` starts the whole-site test (`/jobs/full` on the worker, its own queue of one, so free scans are never blocked). `worker/src/crawl.ts` walks the site breadth first with the free scan's skip rules, robots.txt and a pause between pages; pages the free scan already tested are only loaded for their links. Each tested page is sent on its own (`page` message, with that page's AI usage); the site stores it in `full_pages`, charges the spend (`paid`, one row per page) and answers `stop: true` once the report reaches `AGENT_REPORT_CAP_USD`. The report page merges `scans.raw` with `full_pages` before the pure `buildReport`. A run that goes quiet is resumed from the stored pages, by the report page and the daily cron. When it ends, one email with the PDF goes to the buyer.

**Tech Stack:** Next.js 16, postgres.js, Express worker, Playwright, Vitest, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-10-09-testing-agent-design.md` section 5 (and 4, 7, 8.6, 11.1, 11.2 limits).

## Global Constraints

- Up to 50 pages in all, counting the free scan's pages (`FULL_REPORT_PAGES = 50`). Same host, same skip rules as the free scan (login, search, basket, settings, tracking links, files), robots.txt, at least 1 second between page loads.
- Each page: axe-core, the agent when the site sends `agent: true`, and fixes (AI fixes up to 300 per report, `AI_FIXES_PER_REPORT`).
- Paid work is outside the daily cap. The agent runs on paid work when the site has the key and both prices. `AGENT_REPORT_CAP_USD` defaults to 15: at or over it, testing stops and the report says how many pages it covers.
- Spend: `agent_spend` kind `paid`, one row per page (`ref` = page address), charged once however often a message repeats.
- `buildReport` stays pure: the report page passes one merged `RawScan`.
- A restart resumes: the job is sent again with the pages already done. A run with no news for 20 minutes is resumed; after 3 resumes it is finished with what it has.
- One completion email, with the PDF. The email at purchase says the rest of the site is being tested and carries no PDF when the whole-site test has started.
- Payment code (`fulfil`, Stripe routes, checkout) does not change.
- New customer-facing wording goes into the owner's design doc as awaiting approval. British spelling, short sentences, no em-dash chains, no "not X, but Y". Never "compliant" or "legally safe".
- Do not touch `.gitignore`, `eslint.config.mjs`, `tsconfig.json`, `.design-sync/`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. The worker repeats a `page` message: stored once, charged once, counted once.
2. A resumed run must not test a page again or lose the pages already stored, and must keep within 50 pages and 300 AI fixes in all.
3. The cap: a page that crosses $15 is kept; no page after it is tested.
4. A full run that never finishes (worker gone): the customer still gets the completion email, with what was tested.
5. Reports bought before phase 4 (no whole-site test): look and behave exactly as before, and are never resumed.

---

### Task 1: Tables and queries

**Files:** `supabase/migrations/0004_full_pages.sql`; `src/lib/data.ts`; test `tests/unit/full-data.test.ts`.

Migration:

```sql
-- Pages of the paid whole-site test, sent one by one by the worker.
create table full_pages (
  id bigint generated always as identity primary key,
  scan_id uuid not null references scans (id) on delete cascade,
  url text not null,
  page jsonb not null,
  created_at timestamptz not null default now(),
  unique (scan_id, url)
);
alter table full_pages enable row level security;
-- (revoke block as in 0002)

-- The whole-site test of each paid report. Null status: bought before it existed.
alter table reports add column full_status text check (full_status in ('running', 'done', 'limit', 'stopped')),
  add column full_pages integer not null default 0,
  add column full_updated_at timestamptz,
  add column full_attempts integer not null default 0,
  add column full_emailed_at timestamptz;

-- Paid spend is charged per page: the page address tells repeats apart.
alter table agent_spend add column ref text not null default '';
drop index agent_spend_once;
create unique index agent_spend_once on agent_spend (scan_id, kind, ref) where kind in ('free', 'paid');
```

Queries (`ReportRow` gains `full_status`, `full_pages`, `full_updated_at`, `full_attempts`, `full_emailed_at`):
- `saveFullPage(scanId, url, page: RawPage): Promise<boolean>` (insert on conflict do nothing; true when new) and `listFullPages(scanId): Promise<RawPage[]>` in insertion order.
- `startFullJob(reportId): Promise<void>` sets `full_status = 'running'`, `full_updated_at = now()`, `full_attempts = full_attempts + 1`.
- `touchFullJob(reportId, pages: number)` sets `full_pages` and `full_updated_at = now()` while running.
- `finishFullJob(reportId, status: "done" | "limit" | "stopped"): Promise<boolean>` only from running; true when it changed.
- `claimFullEmail(reportId): Promise<boolean>` sets `full_emailed_at` once.
- `staleFullJobs(minutes): Promise<ReportRow[]>` running with `full_updated_at` older than that.
- `recordScanSpend` takes `ref?: string` (default `""`); `paidSpendUsd(scanId): Promise<number>`.

- [ ] Tests first (store a page twice → one row, true then false; list order; start/touch/finish/claim transitions; stale query; paid spend per page charged once per ref and summed), RED, implement, GREEN, run `tests/unit/spend.test.ts` too (the index changed). Commit `Whole-site test: tables and queries`.

### Task 2: Merging pages, caps and paid agent mode

**Files:** `src/lib/report/full.ts`; `src/lib/spend.ts`; `src/lib/env.ts`; tests `tests/unit/full-merge.test.ts`, `tests/unit/spend.test.ts`.

- `mergeFullPages(raw: RawScan, extra: RawPage[]): RawScan`: the free scan's scanned pages, then `extra` pages whose address (no hash, no trailing slash, lower-case host) is not already there, then the free scan's skipped and failed pages. Pure; `raw` unchanged.
- `FULL_REPORT_PAGES = 50`, `AI_FIXES_PER_REPORT = 300`.
- `aiFixesUsed(pages: RawPage[]): number` counts nodes with `fix?.source === "ai"`.
- `reportCapUsd()` (`AGENT_REPORT_CAP_USD`, default 15, same parsing as the daily cap); `paidAgentOn(): boolean` (key and prices set).

- [ ] Tests first, RED, implement, GREEN. Commit `Whole-site test: merge pages into one report; the $15 report limit`.

### Task 3: The crawl

**Files:** `worker/src/crawl.ts`; `worker/src/scan.ts` (export what the crawl reuses: `scanPage` gains a `withLinks` argument, `collectLinks` and a `newScanContext(start)` helper shared with `scanSite`); fixtures as needed; test `worker/test/crawl.test.ts`.

`crawlSite(startUrl, opts: CrawlOptions): Promise<{ tested: number; reason: "done" | "limit" | "stopped" | "error" }>`:
- `CrawlOptions`: `done: string[]` (addresses already tested), `maxPages` (in all), `agent?`, `fixBudget?`, `pauseMs?`, `fixTimes?`, `onShot?`, `onPage(page: RawPage): Promise<{ stop: boolean }>`.
- Breadth first from the start address. A page in `done` is loaded only for its links and signature. A new page goes through `scanPage` (axe, agent, fixes) with the same "keep" rules as the free scan (same site, unseen address, unseen signature) and is passed to `onPage`. Failed pages are skipped.
- Stops when `done.length + tested >= maxPages` (`"limit"`), when `onPage` answers stop (`"stopped"`), when nothing is left (`"done"`), or after `maxPages * 3` page loads (`"done"`).
- robots.txt and `crawlDelayMs` as in `scanSite`; `classifyHost` check on the start host.

- [ ] Tests on the fixture site: (a) with `done` = the home page and about page, the crawl tests other linked pages but never those two, and never `/private.html` (robots) or skipped links; (b) `maxPages` = done + 1 → one page, `"limit"`; (c) `onPage` answering stop after the first page → `"stopped"`, one page. Commit `Worker: crawl the whole site breadth first`.

### Task 4: The whole-site job on the worker

**Files:** `worker/src/job.ts` (`runFullJob`); `worker/src/server.ts` (`/jobs/full`, its own `JobQueue(1, 10)`, `callback` returns the parsed answer); test `worker/test/job.test.ts`.

- `runFullJob(url, { model, send, done, maxPages, fixesLeft, crawl? })`: meters the model; for each page sends `shots` (if any) then `{ type: "page", page, agent?: { model, usage } }` where `usage` is the metered usage since the previous page; reads `stop` from the answer; at the end sends `{ type: "done", reason, tested }`. An exception sends `done` with `reason: "error"`.
- `/jobs/full` body: `scanId, url, callbackUrl, agent, done: string[], maxPages, fixesLeft` (validated like `/jobs/scan`).

- [ ] Tests first (fake crawl): per-page usage deltas add up to the total; `stop` from the answer is passed back; an error still sends `done`. Commit `Worker: the whole-site job sends each page as it is tested`.

### Task 5: Starting, receiving and finishing on the site

**Files:** `src/lib/worker.ts` (`dispatchFull`); `src/lib/full.ts` (`startFullTest`, `resumeStaleFullTest`, `finishFullTest`); `src/app/api/worker/full/[id]/route.ts`; `src/lib/shots.ts` (the shots handling shared with the scan route); test `tests/unit/full-route.test.ts`.

- `startFullTest(report, scan)`: `startFullJob`, then `dispatchFull` with `done` = the free scan's scanned addresses plus stored full pages, `maxPages = 50`, `fixesLeft = 300 - aiFixesUsed(stored)`, `agent = paidAgentOn()`. A dispatch error alerts the owner and leaves the run to be resumed.
- Route (worker secret): `shots` as today; `page` → `saveFullPage`, `recordScanSpend` (`paid`, `ref` = page url, cost from prices or null), `touchFullJob` with the stored count; answers `{ ok, stop }` with `stop` when `paidSpendUsd >= reportCapUsd()`; `done` → `finishFullTest(report, reason)`.
- `finishFullTest`: `finishFullJob` (`limit` when the cap stopped it, `stopped` for error/give-up, else `done`); then, once (`claimFullEmail`), the completion email with the PDF.
- `resumeStaleFullTest(report)`: running and quiet for 20 minutes → `startFullTest` again; at 3 attempts → `finishFullTest(report, "stopped")`.

- [ ] Tests first (route with a stubbed worker fetch): a repeated `page` message stores and charges once; `stop` once paid spend reaches the cap; `done` finishes and emails once (outbox); resume after 20 quiet minutes re-dispatches with the stored pages as done; the fourth attempt finishes instead. Commit `Whole-site test: start it, store each page, stop at the report limit`.

### Task 6: Emails

**Files:** `src/lib/fulfil.ts` (`deliverReport` starts the test; PDF only when it could not start), `emails/report-ready.html` (`{{pdf_note}}` replaces the fixed PDF sentence), new `emails/full-report-ready.html`, `emails/README.md`, `src/lib/email/wording.ts`, `src/app/dev/emails/page.tsx`; tests `tests/unit/email.test.ts`.

Wording (to the design doc):
- Purchase email, test started: "We are now testing the rest of your site, up to 50 pages. We will email you again when it is finished, with the PDF. The report link already shows the pages tested so far."
- Purchase email, test not started: today's sentence.
- Completion email subject: "Your full Legible report for {{site}} is ready". Body: "We tested {{pages}} on {{site}}. {{ending}}" plus the button and the PDF line. `ending`: done → "That is every page we could reach, up to 50."; limit → "Testing stopped there because this report reached its testing limit."; stopped → "Testing stopped there because of a problem on our side. The pages we tested are all in the report."

- [ ] Tests first (template variables render; wording per ending). Commit `Emails: the purchase email says the whole site is being tested; one email when it is done`.

### Task 7: The report page and the cron

**Files:** `src/app/report/[token]/page.tsx`, `src/app/report/[token]/pdf/route.ts` (if it builds the report itself), `src/app/api/cron/daily/route.ts`, `src/lib/data.ts` (`getReportByToken` unchanged), test `tests/unit/full-display.test.ts`.

- The report merges `listFullPages` into the raw scan before `buildReport` (page and PDF).
- A note at the top while running, and after: running → "We are testing the rest of your site. {n} of up to 50 pages so far. This page fills in as we go."; done → nothing extra; limit → "This report covers {n} pages. Testing stopped there because it reached its testing limit."; stopped → "This report covers {n} pages. Testing stopped early because of a problem on our side."
- The welcome status after purchase: "Payment received. We are testing the rest of your site now. We will email {email} when the full report is ready, with the PDF." (only when a test is running).
- Viewing a running report whose test went quiet resumes it (`after()`); the daily cron resumes every stale run.

- [ ] Tests first (note text per state; merge used by the page via a small exported loader). Commit `Report: fills in as the whole site is tested; quiet runs resume`.

### Task 8: Wording, docs and the full check

- Design doc rows for every string in Tasks 6 and 7; `CLAUDE.md` architecture bullet; `.env.example` and `scripts/setup.mjs` (`AGENT_REPORT_CAP_USD=15`).
- e2e: the purchase email has no PDF and says the rest is being tested; the completion email arrives with the PDF; the report shows more pages than the free scan.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm --prefix worker test`, `npm run test:e2e` → all pass. Commit `Wording and docs for the whole-site test`.
