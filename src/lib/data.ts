import "server-only";
import type { JSONValue } from "postgres";
import type { AgentUsage, RawPage, RawScan, ScanStatus } from "@/types/scan";
import type { FreeSummary } from "./report/model";
import { db } from "./db";

// Every database query the site makes lives in this file.

// Whether a free scan was sent with the testing agent (see src/lib/spend.ts).
export type AgentMode = "on" | "capped" | "off";
export type SpendKind = "free" | "paid" | "chat_free" | "chat_paid";

export interface ScanRow {
  id: string;
  url: string;
  host: string;
  status: ScanStatus;
  error: string | null;
  pages_done: number;
  pages_total: number | null;
  score: number | null;
  summary: FreeSummary | null;
  lead_email: string | null;
  paid_at: Date | null;
  agent: AgentMode;
  created_at: Date;
  finished_at: Date | null;
}

export interface ReportRow {
  id: string;
  scan_id: string;
  user_id: string;
  token: string;
  stripe_session_id: string | null;
  amount_cents: number;
  currency: string;
  delivered_at: Date | null;
  offer_sent_at: Date | null;
  created_at: Date;
  // The paid whole-site test. Null status: bought before it existed.
  full_status: FullStatus | null;
  full_pages: number;
  full_updated_at: Date | null;
  full_attempts: number;
  full_emailed_at: Date | null;
}

export type FullStatus = "running" | "done" | "limit" | "stopped";

export interface UserRow {
  id: string;
  email: string;
  marketing_emails: boolean;
  created_at: Date;
}

const SCAN_COLUMNS = [
  "id", "url", "host", "status", "error", "pages_done", "pages_total",
  "score", "summary", "lead_email", "paid_at", "agent", "created_at", "finished_at",
];

// ── scans ────────────────────────────────────────────────────────────

export async function createScan(input: {
  url: string;
  host: string;
  ipHash: string | null;
  agent?: AgentMode;
}): Promise<ScanRow> {
  const sql = db();
  const [row] = await sql<ScanRow[]>`
    insert into scans (url, host, ip_hash, agent)
    values (${input.url}, ${input.host}, ${input.ipHash}, ${input.agent ?? "off"})
    returning ${sql(SCAN_COLUMNS)}`;
  return row;
}

export async function getScan(id: string): Promise<ScanRow | null> {
  if (!isUuid(id)) return null;
  const sql = db();
  const [row] = await sql<ScanRow[]>`select ${sql(SCAN_COLUMNS)} from scans where id = ${id}`;
  return row ?? null;
}

export async function getScanRaw(id: string): Promise<RawScan | null> {
  const [row] = await db()<{ raw: RawScan | null }[]>`select raw from scans where id = ${id}`;
  return row?.raw ?? null;
}

export async function markScanProgress(id: string, done: number, total: number | null): Promise<void> {
  await db()`
    update scans set
      status = 'running',
      started_at = coalesce(started_at, now()),
      pages_done = ${done},
      pages_total = ${total}
    where id = ${id} and status in ('queued', 'running')`;
}

export async function completeScan(
  id: string,
  input: { raw: RawScan; score: number | null; summary: FreeSummary; pagesDone: number },
): Promise<boolean> {
  const sql = db();
  const rows = await sql`
    update scans set
      status = 'complete',
      raw = ${sql.json(input.raw as unknown as JSONValue)},
      score = ${input.score},
      summary = ${sql.json(input.summary as unknown as JSONValue)},
      pages_done = ${input.pagesDone},
      pages_total = ${input.pagesDone},
      error = null,
      finished_at = now()
    where id = ${id} and status in ('queued', 'running')
    returning id`;
  return rows.length > 0;
}

export async function failScan(id: string, error: string): Promise<boolean> {
  const rows = await db()`
    update scans set status = 'failed', error = ${error}, finished_at = now()
    where id = ${id} and status in ('queued', 'running')
    returning id`;
  return rows.length > 0;
}

export async function saveShots(scanId: string, shots: { id: string; jpeg: Buffer }[]): Promise<void> {
  if (!shots.length) return;
  const sql = db();
  const rows = shots.map((s) => ({ id: s.id, scan_id: scanId, image: s.jpeg }));
  await sql`insert into scan_shots ${sql(rows)} on conflict (id) do nothing`;
}

export async function getShot(id: string): Promise<Buffer | null> {
  const sql = db();
  const rows = await sql<{ image: Buffer }[]>`select image from scan_shots where id = ${id}`;
  return rows[0]?.image ?? null;
}

export async function failStaleScans(olderThanMinutes: number): Promise<number> {
  const rows = await db()`
    update scans set status = 'failed', error = 'timeout', finished_at = now()
    where status in ('queued', 'running')
      and created_at < now() - make_interval(mins => ${olderThanMinutes})
    returning id`;
  return rows.length;
}

export async function countScansByIp(ipHash: string, minutes: number): Promise<number> {
  const [row] = await db()<{ n: number }[]>`
    select count(*)::int as n from scans
    where ip_hash = ${ipHash} and created_at > now() - make_interval(mins => ${minutes})`;
  return row.n;
}

export async function countScansByHost(host: string, minutes: number): Promise<number> {
  const [row] = await db()<{ n: number }[]>`
    select count(*)::int as n from scans
    where host = ${host} and created_at > now() - make_interval(mins => ${minutes})`;
  return row.n;
}

export async function countActiveScans(): Promise<number> {
  const [row] = await db()<{ n: number }[]>`
    select count(*)::int as n from scans
    where status in ('queued', 'running') and created_at > now() - interval '10 minutes'`;
  return row.n;
}

export async function isBlockedHost(host: string): Promise<boolean> {
  const bare = host.replace(/^www\./, "");
  const rows = await db()`select 1 from blocked_domains where host in (${host}, ${bare}, ${"www." + bare})`;
  return rows.length > 0;
}

export async function setLeadEmail(scanId: string, email: string): Promise<void> {
  await db()`update scans set lead_email = ${email} where id = ${scanId}`;
}

// ── agent spend ──────────────────────────────────────────────────────

// Each charge is recorded once (a unique index on scan, kind and ref refuses a repeat).
export async function recordScanSpend(input: {
  scanId: string;
  kind: SpendKind;
  model: string;
  usage: AgentUsage;
  costUsd: number | null;
  // Tells charges of one scan apart: the page address for paid pages.
  ref?: string;
}): Promise<boolean> {
  const u = input.usage;
  const rows = await db()`
    insert into agent_spend (scan_id, kind, ref, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
    values (${input.scanId}, ${input.kind}, ${input.ref ?? ""}, ${input.model}, ${u.inputTokens}, ${u.outputTokens},
            ${u.cacheReadTokens}, ${u.cacheWriteTokens}, ${input.costUsd})
    on conflict do nothing
    returning id`;
  return rows.length > 0;
}

// Free scans and free chat since midnight UTC.
export async function freeSpendTodayUsd(): Promise<number> {
  const [row] = await db()<{ total: string | null }[]>`
    select sum(cost_usd) as total from agent_spend
    where kind in ('free', 'chat_free')
      and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`;
  return Number(row?.total ?? 0);
}

// Free agent scans sent to the worker but not charged yet. Older than the
// stale-scan limit, they are treated as lost.
export async function freeAgentScansInFlight(): Promise<number> {
  const [row] = await db()<{ n: number }[]>`
    select count(*)::int as n from scans s
    where s.agent = 'on' and s.status in ('queued', 'running')
      and s.created_at > now() - interval '90 minutes'
      and not exists (select 1 from agent_spend a where a.scan_id = s.id and a.kind = 'free')`;
  return row.n;
}

// What one free agent scan cost on average over the last 7 days; null before the first.
export async function averageFreeScanCostUsd(): Promise<number | null> {
  const [row] = await db()<{ avg: string | null }[]>`
    select avg(cost_usd) as avg from agent_spend
    where kind = 'free' and cost_usd is not null and created_at > now() - interval '7 days'`;
  return row?.avg == null ? null : Number(row.avg);
}

// What the paid whole-site test of a scan has cost so far.
export async function paidSpendUsd(scanId: string): Promise<number> {
  const [row] = await db()<{ total: string | null }[]>`
    select sum(cost_usd) as total from agent_spend where scan_id = ${scanId} and kind = 'paid'`;
  return Number(row?.total ?? 0);
}

// ── whole-site test ──────────────────────────────────────────────────

export async function saveFullPage(scanId: string, url: string, page: RawPage): Promise<boolean> {
  const sql = db();
  const rows = await sql`
    insert into full_pages (scan_id, url, page) values (${scanId}, ${url}, ${sql.json(page as unknown as JSONValue)})
    on conflict (scan_id, url) do nothing
    returning id`;
  return rows.length > 0;
}

export async function listFullPages(scanId: string): Promise<RawPage[]> {
  const rows = await db()<{ page: RawPage }[]>`select page from full_pages where scan_id = ${scanId} order by id`;
  return rows.map((r) => r.page);
}

export async function countFullPages(scanId: string): Promise<number> {
  const [row] = await db()<{ n: number }[]>`select count(*)::int as n from full_pages where scan_id = ${scanId}`;
  return row.n;
}

// Starts run number N (returned). Every message of a run carries its number,
// so messages from an older run are recognised and ignored.
export async function startFullJob(reportId: string): Promise<number> {
  const [row] = await db()<{ full_attempts: number }[]>`
    update reports set full_status = 'running', full_updated_at = now(), full_attempts = full_attempts + 1
    where id = ${reportId}
    returning full_attempts`;
  return row?.full_attempts ?? 0;
}

// Claims the next run of a running test, in one step, so two callers at once
// never start two runs. With `quietMinutes`, only when the run has been quiet
// that long; with `fromAttempt`, only when run N is still the current one.
export async function claimNextFullRun(
  reportId: string,
  opts: { quietMinutes?: number; fromAttempt?: number },
): Promise<ReportRow | null> {
  const sql = db();
  const [row] = await sql<ReportRow[]>`
    update reports set full_attempts = full_attempts + 1, full_updated_at = now()
    where id = ${reportId} and full_status = 'running'
      ${opts.quietMinutes === undefined ? sql`` : sql`and full_updated_at < now() - make_interval(mins => ${opts.quietMinutes})`}
      ${opts.fromAttempt === undefined ? sql`` : sql`and full_attempts = ${opts.fromAttempt}`}
    returning *`;
  return row ?? null;
}

// A run that says it is alive (waiting in the queue or working).
export async function aliveFullJob(reportId: string): Promise<void> {
  await db()`update reports set full_updated_at = now() where id = ${reportId} and full_status = 'running'`;
}

export async function touchFullJob(reportId: string, pages: number): Promise<void> {
  await db()`
    update reports set full_pages = ${pages}, full_updated_at = now()
    where id = ${reportId} and full_status = 'running'`;
}

export async function finishFullJob(reportId: string, status: Exclude<FullStatus, "running">): Promise<boolean> {
  const rows = await db()`
    update reports set full_status = ${status}, full_updated_at = now()
    where id = ${reportId} and full_status = 'running'
    returning id`;
  return rows.length > 0;
}

// True for the one caller allowed to send the completion email.
export async function claimFullEmail(reportId: string): Promise<boolean> {
  const rows = await db()`
    update reports set full_emailed_at = now() where id = ${reportId} and full_emailed_at is null returning id`;
  return rows.length > 0;
}

// After a failed send, so the email is tried again.
export async function releaseFullEmail(reportId: string): Promise<void> {
  await db()`update reports set full_emailed_at = null where id = ${reportId}`;
}

// Finished tests whose email has not gone out (a send that failed).
export async function unsentFullEmails(minutes: number): Promise<ReportRow[]> {
  return db()<ReportRow[]>`
    select * from reports
    where full_status in ('done', 'limit', 'stopped') and full_emailed_at is null
      and full_updated_at < now() - make_interval(mins => ${minutes})`;
}

export async function staleFullJobs(minutes: number): Promise<ReportRow[]> {
  return db()<ReportRow[]>`
    select * from reports
    where full_status = 'running' and full_updated_at < now() - make_interval(mins => ${minutes})`;
}

// ── users ────────────────────────────────────────────────────────────

export async function upsertUser(email: string): Promise<UserRow> {
  const [row] = await db()<UserRow[]>`
    insert into users (email) values (${email.toLowerCase()})
    on conflict (email) do update set email = excluded.email
    returning id, email, marketing_emails, created_at`;
  return row;
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const [row] = await db()<UserRow[]>`
    select id, email, marketing_emails, created_at from users where email = ${email.toLowerCase()}`;
  return row ?? null;
}

export async function setMarketingEmails(email: string, value: boolean): Promise<void> {
  await db()`
    insert into users (email, marketing_emails) values (${email.toLowerCase()}, ${value})
    on conflict (email) do update set marketing_emails = ${value}`;
}

// ── reports ──────────────────────────────────────────────────────────

// Idempotent: the unique scan_id means a second call (a repeated webhook, or
// the webhook and the success page racing) finds the existing report.
export async function createReportOnce(input: {
  scanId: string;
  userId: string;
  token: string;
  stripeSessionId: string | null;
  amountCents: number;
  currency: string;
}): Promise<{ report: ReportRow; created: boolean }> {
  const sql = db();
  const result = await sql.begin(async (tx) => {
    await tx`update scans set paid_at = coalesce(paid_at, now()), user_id = ${input.userId} where id = ${input.scanId}`;
    const inserted = await tx<ReportRow[]>`
      insert into reports (scan_id, user_id, token, stripe_session_id, amount_cents, currency)
      values (${input.scanId}, ${input.userId}, ${input.token}, ${input.stripeSessionId}, ${input.amountCents}, ${input.currency})
      on conflict (scan_id) do nothing
      returning *`;
    if (inserted.length) return { report: inserted[0], created: true };
    const [existing] = await tx<ReportRow[]>`select * from reports where scan_id = ${input.scanId}`;
    return { report: existing, created: false };
  });
  return result as { report: ReportRow; created: boolean };
}

export async function getReportByToken(
  token: string,
): Promise<(ReportRow & { email: string; host: string; raw: RawScan }) | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [row] = await db()<(ReportRow & { email: string; host: string; raw: RawScan })[]>`
    select r.*, u.email, s.host, s.raw
    from reports r join users u on u.id = r.user_id join scans s on s.id = r.scan_id
    where r.token = ${token}`;
  return row ?? null;
}

export async function getReportByScanId(scanId: string): Promise<ReportRow | null> {
  if (!isUuid(scanId)) return null;
  const [row] = await db()<ReportRow[]>`select * from reports where scan_id = ${scanId}`;
  return row ?? null;
}

export async function listReportsForEmail(
  email: string,
): Promise<{ token: string; host: string; score: number | null; created_at: Date; scanned_at: Date | null }[]> {
  return db()<{ token: string; host: string; score: number | null; created_at: Date; scanned_at: Date | null }[]>`
    select r.token, s.host, s.score, r.created_at, s.finished_at as scanned_at
    from reports r join users u on u.id = r.user_id join scans s on s.id = r.scan_id
    where u.email = ${email.toLowerCase()}
    order by r.created_at desc`;
}

export async function markReportDelivered(reportId: string): Promise<void> {
  await db()`update reports set delivered_at = now() where id = ${reportId}`;
}

export async function reportsDueForOffer(): Promise<
  { id: string; token: string; host: string; email: string; score: number | null }[]
> {
  return db()<{ id: string; token: string; host: string; email: string; score: number | null }[]>`
    select r.id, r.token, s.host, u.email, s.score
    from reports r join users u on u.id = r.user_id join scans s on s.id = r.scan_id
    where r.delivered_at < now() - interval '3 days'
      and r.offer_sent_at is null
      and u.marketing_emails
      and not exists (
        select 1 from subscriptions sub where sub.user_id = u.id and sub.site_host = s.host
      )
    order by r.delivered_at
    limit 50`;
}

// Claims the offer before sending, so two overlapping cron runs cannot both
// email the same customer.
export async function claimOffer(reportId: string): Promise<boolean> {
  const rows = await db()`
    update reports set offer_sent_at = now() where id = ${reportId} and offer_sent_at is null returning id`;
  return rows.length > 0;
}

export async function releaseOffer(reportId: string): Promise<void> {
  await db()`update reports set offer_sent_at = null where id = ${reportId}`;
}

// ── monitoring requests ──────────────────────────────────────────────

export async function requestMonitoring(userId: string, host: string): Promise<boolean> {
  const rows = await db()`
    insert into subscriptions (user_id, site_host) values (${userId}, ${host})
    on conflict (user_id, site_host, plan) do nothing
    returning id`;
  return rows.length > 0;
}

// ── Stripe events ────────────────────────────────────────────────────

export async function recordStripeEvent(id: string, type: string): Promise<boolean> {
  const rows = await db()`
    insert into stripe_events (id, type) values (${id}, ${type}) on conflict (id) do nothing returning id`;
  return rows.length > 0;
}

export async function forgetStripeEvent(id: string): Promise<void> {
  await db()`delete from stripe_events where id = ${id}`;
}

// ── sign-in links ────────────────────────────────────────────────────

export async function saveLoginToken(email: string, tokenHash: string, minutes: number): Promise<void> {
  await db()`
    insert into login_tokens (token_hash, email, expires_at)
    values (${tokenHash}, ${email.toLowerCase()}, now() + make_interval(mins => ${minutes}))`;
}

export async function consumeLoginToken(tokenHash: string): Promise<string | null> {
  const [row] = await db()<{ email: string }[]>`
    update login_tokens set used_at = now()
    where token_hash = ${tokenHash} and used_at is null and expires_at > now()
    returning email`;
  return row?.email ?? null;
}

export async function countRecentLoginTokens(email: string, minutes: number): Promise<number> {
  const [row] = await db()<{ n: number }[]>`
    select count(*)::int as n from login_tokens
    where email = ${email.toLowerCase()} and created_at > now() - make_interval(mins => ${minutes})`;
  return row.n;
}

export async function deleteExpiredLoginTokens(): Promise<void> {
  await db()`delete from login_tokens where expires_at < now() - interval '1 day'`;
}

// ── email log ────────────────────────────────────────────────────────

export async function logEmail(to: string, template: string, providerId: string | null): Promise<void> {
  await db()`insert into email_log (to_email, template, provider_id) values (${to}, ${template}, ${providerId})`;
}

// ── owner dashboard ──────────────────────────────────────────────────

export interface Stats {
  period: string;
  scans: number;
  completed: number;
  failed: number;
  paid: number;
  revenue_cents: number;
  leads: number;
  monitoring_requests: number;
}

export async function stats(): Promise<Stats[]> {
  return db()<Stats[]>`
    with periods(period, since) as (
      values ('Last 7 days', now() - interval '7 days'),
             ('Last 30 days', now() - interval '30 days'),
             ('All time', '-infinity'::timestamptz)
    )
    select w.period,
      (select count(*)::int from scans s where s.created_at >= w.since) as scans,
      (select count(*)::int from scans s where s.created_at >= w.since and s.status = 'complete') as completed,
      (select count(*)::int from scans s where s.created_at >= w.since and s.status = 'failed') as failed,
      (select count(*)::int from reports r where r.created_at >= w.since) as paid,
      (select coalesce(sum(amount_cents), 0)::int from reports r where r.created_at >= w.since) as revenue_cents,
      (select count(*)::int from scans s where s.created_at >= w.since and s.lead_email is not null) as leads,
      (select count(*)::int from subscriptions m where m.created_at >= w.since) as monitoring_requests
    from periods w`;
}

export async function recentFailures(): Promise<{ id: string; host: string; error: string | null; created_at: Date }[]> {
  return db()<{ id: string; host: string; error: string | null; created_at: Date }[]>`
    select id, host, error, created_at from scans where status = 'failed' order by created_at desc limit 10`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
