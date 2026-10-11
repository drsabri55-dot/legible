import AxeBuilder from "@axe-core/playwright";
import axeCore from "axe-core";
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from "playwright";
import { allowPrivateTargets, classifyHost, makeHostGuard } from "./net";
import { BOT_NAME, loadRobots } from "./robots";
import type { RawNode, RawPage, RawRule, RawScan } from "./types";
import { addUsage, emptyUsage, type AgentModel } from "./agent/model";
import { AGENT_BUDGET_MS, runAgentOnPage } from "./agent/run";
import { BUILDER_PROBE } from "./builder";
import { AI_FIXES_PER_SCAN, writeFix } from "./fixes/ai";
import { testRuleFixes } from "./fixes/rules";

export const MAX_PAGES = 6;
// Page loads allowed after the home page, including ones that fail.
export const MAX_ATTEMPTS = 8;
export const PAGE_TIMEOUT_MS = 30_000;
// Time on each page for trying rule-based fixes, and for AI-written ones.
export const RULE_FIX_MS = 20_000;
export const AI_FIX_MS = 90_000;
export const PAUSE_BETWEEN_PAGES_MS = 1000;
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const NODES_PER_RULE = 25;
const REVIEW_NODES_PER_RULE = 3;
const HTML_LIMIT = 800;
const SUMMARY_LIMIT = 400;
const MAX_PAYLOAD_BYTES = 3_500_000;

export class ScanError extends Error {
  constructor(public code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export function userAgent(): string {
  const info = process.env.BOT_INFO_URL || `${(process.env.APP_URL || "https://legible.example").replace(/\/+$/, "")}/bot`;
  return `Mozilla/5.0 (compatible; ${BOT_NAME}/1.0; +${info})`;
}

let browserPromise: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b && b.isConnected()) return b;
  }
  browserPromise = chromium.launch({ args: ["--disable-dev-shm-usage"] });
  const b = await browserPromise;
  b.on("disconnected", () => {
    browserPromise = null;
  });
  return b;
}

export async function closeBrowser(): Promise<void> {
  const b = await browserPromise?.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => {});
}

function truncate(value: string | undefined | null, limit: number): string {
  if (!value) return "";
  return value.length > limit ? value.slice(0, limit) + "…" : value;
}

type AxeResult = Awaited<ReturnType<AxeBuilder["analyze"]>>;
type AxeRuleResult = AxeResult["violations"][number];

function contrastData(node: AxeRuleResult["nodes"][number]): Record<string, unknown> | null {
  for (const check of [...node.any, ...node.all, ...node.none]) {
    if (check.id !== "color-contrast" && check.id !== "color-contrast-enhanced") continue;
    const d = (check.data || {}) as Record<string, unknown>;
    return {
      fgColor: d.fgColor,
      bgColor: d.bgColor,
      contrastRatio: d.contrastRatio,
      expectedContrastRatio: d.expectedContrastRatio,
      fontSize: d.fontSize,
      fontWeight: d.fontWeight,
    };
  }
  return null;
}

function trimRule(rule: AxeRuleResult, keep: number): RawRule {
  const nodes: RawNode[] = rule.nodes.slice(0, keep).map((n) => ({
    html: truncate(n.html, HTML_LIMIT),
    target: n.target.map((t) => (Array.isArray(t) ? t.join(" ") : String(t))),
    failureSummary: truncate(n.failureSummary, SUMMARY_LIMIT) || undefined,
    impact: n.impact ?? null,
    data: rule.id === "color-contrast" ? contrastData(n) : null,
  }));
  return {
    id: rule.id,
    impact: rule.impact ?? null,
    help: rule.help,
    description: rule.description,
    helpUrl: rule.helpUrl,
    tags: rule.tags,
    nodeCount: rule.nodes.length,
    nodes,
  };
}

export function toRawPage(url: string, title: string, axe: AxeResult): RawPage {
  return {
    url,
    status: "scanned",
    title: truncate(title, 200),
    violations: axe.violations.map((r) => trimRule(r, NODES_PER_RULE)),
    incomplete: axe.incomplete.map((r) => trimRule(r, REVIEW_NODES_PER_RULE)),
    passes: axe.passes.map((r) => ({ id: r.id, nodeCount: r.nodes.length })),
    inapplicable: axe.inapplicable.map((r) => r.id),
  };
}

// The host of the page loaded in the frame an element sits in. axe gives one
// selector per frame level, so all but the last lead through the frames.
// Returns null for frames without a web address of their own (about:blank,
// srcdoc) or ones that cannot be found again.
async function frameHostOf(page: Page, framePath: string[]): Promise<string | null> {
  let frame: Frame = page.mainFrame();
  try {
    for (const selector of framePath) {
      const handle = await frame.$(`css=${selector}`);
      const inner = handle ? await handle.contentFrame() : null;
      await handle?.dispose();
      if (!inner) return null;
      frame = inner;
    }
    const url = new URL(frame.url());
    return url.protocol === "http:" || url.protocol === "https:" ? url.hostname : null;
  } catch {
    return null;
  }
}

// Marks failing elements that sit inside frames with the frame's host, so the
// report can tell the owner's own code from content embedded from elsewhere.
async function addFrameHosts(page: Page, rules: RawRule[]): Promise<void> {
  const hosts = new Map<string, string | null>();
  for (const rule of rules) {
    for (const node of rule.nodes) {
      if (node.target.length < 2) continue;
      const framePath = node.target.slice(0, -1);
      const key = framePath.join("\u0000");
      if (!hosts.has(key)) hosts.set(key, await frameHostOf(page, framePath));
      const host = hosts.get(key);
      if (host) node.frameHost = host;
    }
  }
}

const SKIP_EXTENSIONS = /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|pptx?|mp4|mp3|mov|avi|ics|csv|xml|rss|json)$/i;

function sameSite(a: string, b: string): boolean {
  return a.replace(/^www\./, "") === b.replace(/^www\./, "");
}

// Links that lead to sign-in, account, basket or search pages. They are
// rarely public content, often answer 401/403, and a search page with no
// query says nothing about the site.
const SKIP_PATHS =
  /(^|[/_-])(auth|oauth|sso|login|log-in|logout|log-out|signin|sign-in|signout|sign-out|signup|sign-up|register|account|my-account|profile|settings|preferences|order-history|orders|cart|basket|checkout|wishlist|search|recherche|suche|buscar|cerca|wp-admin|wp-login)([/_.-]|$)/i;
// Links that exist to send people somewhere else: a parameter named like
// "…redirect…", "…return…" or "callback", or one whose value is a web address
// (tracking redirects), and search queries.
const SKIP_QUERY = /[?&]([^=&]*(callback|redirect|return|continue|goto)[^=&]*|next|q|query|s)=|=(https?(:|%3a))/i;

// Parameters that track a click without changing the page.
const TRACKING_PARAM = /^(utm_.*|ref|ref_|fbclid|gclid|msclkid|mc_[a-z]+|_encoding|ie|_ga|_gl)$/i;

// One key per page: scheme, www, trailing slash and tracking parameters do
// not make a new page.
export function pageKey(u: URL): string {
  const params = new URLSearchParams(u.search);
  for (const name of [...params.keys()]) if (TRACKING_PARAM.test(name)) params.delete(name);
  params.sort();
  const query = params.toString();
  return u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "") + (query ? `?${query}` : "");
}

// Bot-protection screens ("Just a moment…", "Client Challenge") answer with
// a normal page. Scanning them would score the challenge, not the site.
const CHALLENGE_TITLE =
  /(just a moment|client challenge|attention required|access denied|checking (your|the) browser|verify(ing)? (you are|that you are) (a )?human|are you (a )?(human|robot)|robot or human|security check|pardon our interruption|request unsuccessful|ddos-guard)/i;
const CHALLENGE_PROBE = `(function () {
  var marker = document.querySelector('#challenge-form, #challenge-running, #cf-challenge-running, .cf-browser-verification, #px-captcha, #sec-if-cpt-container');
  var text = (document.body && document.body.innerText || '').trim().length;
  return !!marker && text < 2000;
})()`;

// Up to five more pages, taken from the site's navigation first. Sites with
// no <nav> fall back to the header, then to links anywhere on the page.
// What makes two addresses the same page ("/" and "/index.html", or "/" and
// "/news"): the same title and the same visible text once numbers are
// removed, since counts and times change between loads. Pages with little
// text (an app shell still loading, a gallery) are never matched.
const PAGE_SIGNATURE = `(function () {
  var t = (document.title + " | " + (document.body ? document.body.innerText : "")).toLowerCase();
  t = t.replace(/[0-9]+/g, "").replace(/\\s+/g, " ").trim();
  if (t.length < 200) return null;
  var h = 5381;
  for (var i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return t.length + ":" + h;
})()`;

async function collectLinks(page: Page, base: URL): Promise<string[]> {
  // Passed as a string: tsx adds helper calls to compiled functions that do
  // not exist inside the page.
  const groups = (await page.evaluate(`
    [
      'nav a[href], [role="navigation"] a[href]',
      'header a[href]',
      'main a[href], footer a[href]',
      'a[href]'
    ].map(function (selector) {
      return Array.prototype.map.call(document.querySelectorAll(selector), function (a) { return a.href; });
    })
  `)) as string[][];
  const seen = new Set<string>([pageKey(base)]);
  const out: string[] = [];
  for (const group of groups) {
    for (const href of group) {
      let u: URL;
      try {
        u = new URL(href);
      } catch {
        continue;
      }
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      if (!sameSite(u.hostname, base.hostname)) continue;
      if (SKIP_EXTENSIONS.test(u.pathname)) continue;
      if (SKIP_PATHS.test(u.pathname) || SKIP_QUERY.test(u.search)) continue;
      u.hash = "";
      const key = pageKey(u);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(u.toString());
    }
  }
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new ScanError(code)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Rule-based fixes on every kept page, then (with the agent) one AI-written
// fix for each failure group that has none, while the scan's allowance lasts.
// A failure whose fixes all failed their test gets `fix: null`: guidance only.
function fixTimes(opts: ScanOptions) {
  return opts.fixTimes ?? { ruleMs: RULE_FIX_MS, aiMs: AI_FIX_MS };
}

async function testFixes(page: Page, violations: RawRule[], opts: ScanOptions) {
  const times = fixTimes(opts);
  const failed = await testRuleFixes(page, violations, Date.now() + times.ruleMs);
  if (opts.agent && opts.fixBudget) {
    const deadline = Date.now() + times.aiMs;
    for (const rule of violations) {
      if (opts.fixBudget.left <= 0 || Date.now() >= deadline) break;
      const own = rule.nodes.filter((n) => n.target.length === 1);
      if (!own.length || own.some((n) => n.fix)) continue;
      const node = own.find((n) => failed.includes(n)) ?? own.find((n) => n.fix === undefined);
      if (!node) continue;
      opts.fixBudget.left--;
      node.fix = await writeFix(
        opts.agent,
        page,
        { ruleId: rule.id, help: rule.help, summary: node.failureSummary || rule.description, selector: node.target[0] },
        deadline,
      );
    }
  }
  for (const n of failed) if (n.fix === undefined) n.fix = null;
}

// `keep` says whether the scan will keep this page (not a redirect away or a
// page already scanned); the testing agent only runs on pages that are kept.
async function scanPage(
  context: BrowserContext,
  url: string,
  first: boolean,
  opts: ScanOptions = {},
  keep: (finalUrl: string, signature: string | null) => boolean = () => true,
) {
  const page = await context.newPage();
  try {
    return await withTimeout(
      (async () => {
        let response;
        try {
          // The document first; then up to 10 more seconds for images and
          // scripts. Waiting for every last resource timed out on busy news
          // and shop pages that were perfectly readable.
          response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
        } catch (e) {
          const msg = String((e as Error).message);
          if (msg.includes("ERR_BLOCKED_BY_CLIENT")) throw new ScanError("blocked_target", msg);
          if (/timeout/i.test(msg)) throw new ScanError("timeout", msg.split("\n")[0]);
          throw new ScanError("unreachable", msg.split("\n")[0]);
        }
        if (!response) throw new ScanError("unreachable", "no response");
        const status = response.status();
        if (status === 404 || status === 410) throw new ScanError("not_found", `HTTP ${status}`);
        if ([401, 403, 429, 503].includes(status)) throw new ScanError("refused", `HTTP ${status}`);
        if (status >= 400) throw new ScanError("unreachable", `HTTP ${status}`);
        const type = response.headers()["content-type"] || "";
        if (type && !/html/i.test(type)) throw new ScanError("not_html", type);
        await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
        // Give late scripts a moment to render, without waiting forever on
        // pages that never go quiet (chat widgets, analytics beacons).
        await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
        const heading = await page.title().catch(() => "");
        // Challenge screens have short titles; a long title is a real page
        // that happens to use one of these words.
        const challengeTitle = heading.length <= 60 && CHALLENGE_TITLE.test(heading);
        if (challengeTitle || (await page.evaluate(CHALLENGE_PROBE).catch(() => false))) {
          throw new ScanError("refused", "bot challenge");
        }
        // runOnly and resultTypes go in one options call: AxeBuilder.options()
        // replaces anything withTags() set earlier.
        const axe = await new AxeBuilder({ page })
          .options({ runOnly: { type: "tag", values: WCAG_TAGS }, resultTypes: ["violations", "incomplete"] })
          .analyze();
        const finalUrl = page.url();
        const links = first ? await collectLinks(page, new URL(finalUrl)) : [];
        const builtWith = first ? ((await page.evaluate(BUILDER_PROBE).catch(() => null)) as string | null) : null;
        const raw = toRawPage(finalUrl, heading, axe);
        await addFrameHosts(page, raw.violations);
        // Taken before the agent, which may leave the page in another state.
        const signature = (await page.evaluate(PAGE_SIGNATURE).catch(() => null)) as string | null;
        const kept = keep(finalUrl, signature);
        if (opts.agent && kept) {
          // The agent must never cost the page its axe-core results.
          try {
            const outcome = await runAgentOnPage(page, { model: opts.agent, onShot: opts.onShot });
            raw.violations.push(...outcome.violations);
            raw.incomplete.push(...outcome.incomplete);
            raw.passes.push(...outcome.passes);
            raw.agent = outcome.result;
          } catch {
            raw.agent = { status: "failed", reason: "agent error", steps: 0, reviews: [], usage: emptyUsage() };
          }
        }
        // Then the fixes, tried on this page before it closes.
        if (kept) {
          // A hard end for the whole fix step, so a stuck call never costs the
          // page its results: what was decided by then is kept.
          const times = fixTimes(opts);
          let timer: NodeJS.Timeout | undefined;
          await Promise.race([
            testFixes(page, raw.violations, opts).catch(() => {
              // A fix that cannot be tried never costs the page its results.
            }),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, times.ruleMs + (opts.agent ? times.aiMs : 0) + 10_000);
            }),
          ]).finally(() => clearTimeout(timer));
        }
        return { raw, links, finalUrl, signature, builtWith };
      })(),
      PAGE_TIMEOUT_MS + 5000 + RULE_FIX_MS + 15_000 + (opts.agent ? AGENT_BUDGET_MS + AI_FIX_MS + 45_000 : 0),
      "timeout",
    );
  } finally {
    await page.close().catch(() => {});
  }
}

function emptyPage(url: string, status: "skipped" | "failed", reason: string): RawPage {
  return { url, status, reason, violations: [], incomplete: [], passes: [], inapplicable: [] };
}

// Keeps the result under the size the site can accept by dropping stored
// example elements (never the counts) until it fits.
export function fitPayload(raw: RawScan): RawScan {
  for (const keep of [NODES_PER_RULE, 10, 5, 2, 1]) {
    for (const page of raw.pages) {
      for (const rule of page.violations) rule.nodes = rule.nodes.slice(0, keep);
      for (const rule of page.incomplete) rule.nodes = rule.nodes.slice(0, Math.min(keep, REVIEW_NODES_PER_RULE));
    }
    if (Buffer.byteLength(JSON.stringify(raw)) <= MAX_PAYLOAD_BYTES) return raw;
  }
  return raw;
}

export interface ScanOptions {
  onProgress?: (done: number, total: number) => void | Promise<void>;
  pauseMs?: number;
  // The testing agent: runs on every page after axe-core when given.
  agent?: AgentModel;
  onShot?: (id: string, jpeg: Buffer) => void | Promise<void>;
  // AI-written fixes left for this scan; set from AI_FIXES_PER_SCAN when missing.
  fixBudget?: { left: number };
  // Time for the fix step on each page (tests use shorter times).
  fixTimes?: { ruleMs: number; aiMs: number };
}

export async function scanSite(startUrl: string, opts: ScanOptions = {}): Promise<RawScan> {
  if (opts.agent && !opts.fixBudget) opts = { ...opts, fixBudget: { left: AI_FIXES_PER_SCAN } };
  const startedAt = new Date().toISOString();
  const ua = userAgent();
  const start = new URL(startUrl);
  const guard = makeHostGuard();
  if (!allowPrivateTargets()) {
    const kind = await classifyHost(start.hostname);
    if (kind === "unresolvable") throw new ScanError("unresolvable");
    if (kind === "private") throw new ScanError("blocked_target");
  }

  const robots = await loadRobots(start.origin, ua);
  if (!robots.isAllowed(start.toString())) throw new ScanError("robots");

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: ua,
    serviceWorkers: "block",
    acceptDownloads: false,
    viewport: { width: 1280, height: 900 },
    locale: "en-GB",
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    let u: URL;
    try {
      u = new URL(request.url());
    } catch {
      return route.abort("blockedbyclient");
    }
    if (u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    if (u.protocol !== "http:" && u.protocol !== "https:") return route.abort("blockedbyclient");
    if (request.resourceType() === "media") return route.abort("blockedbyclient");
    return (await guard(u.hostname)) ? route.continue() : route.abort("blockedbyclient");
  });

  const pages: RawPage[] = [];
  let finalUrl = start.toString();
  let builtWith: string | null = null;
  try {
    // If the start page fails, the whole scan fails with its reason.
    const home = await scanPage(context, start.toString(), true, opts);
    pages.push(home.raw);
    finalUrl = home.finalUrl;
    builtWith = home.builtWith;
    const homeUrl = new URL(finalUrl);
    const scannedKeys = new Set<string>([pageKey(homeUrl)]);
    const signatures = new Set<string>(home.signature ? [home.signature] : []);

    // Robots-excluded links are listed (up to 3) so the owner knows why
    // they are missing; they cost nothing, since they are never fetched.
    const candidates: string[] = [];
    for (const link of home.links) {
      if (robots.isAllowed(link)) candidates.push(link);
      else if (pages.filter((p) => p.status === "skipped").length < 3) pages.push(emptyPage(link, "skipped", "robots"));
    }

    // Up to five more pages. A link that fails, redirects off the site or
    // lands on a page already scanned is replaced by the next candidate,
    // within a limit of attempts so a broken site is not hammered.
    const wanted = Math.min(MAX_PAGES - 1, candidates.length);
    let total = 1 + wanted;
    let done = 1;
    let attempts = 0;
    let failedListed = 0;
    await opts.onProgress?.(done, total);
    for (const link of candidates) {
      if (done - 1 >= wanted || attempts >= MAX_ATTEMPTS) break;
      attempts++;
      await new Promise((r) => setTimeout(r, Math.max(opts.pauseMs ?? PAUSE_BETWEEN_PAGES_MS, robots.crawlDelayMs)));
      try {
        const result = await scanPage(context, link, false, opts, (landedUrl, signature) => {
          const landed = new URL(landedUrl);
          return (
            sameSite(landed.hostname, homeUrl.hostname) &&
            !scannedKeys.has(pageKey(landed)) &&
            !(signature && signatures.has(signature))
          );
        });
        const landed = new URL(result.finalUrl);
        if (!sameSite(landed.hostname, homeUrl.hostname)) continue; // redirected to another website
        const key = pageKey(landed);
        if (scannedKeys.has(key)) continue; // redirected to a page already scanned
        if (result.signature && signatures.has(result.signature)) continue; // a page already scanned, by another address
        scannedKeys.add(key);
        if (result.signature) signatures.add(result.signature);
        pages.push(result.raw);
        done++;
        await opts.onProgress?.(done, total);
      } catch (e) {
        const code = e instanceof ScanError ? e.message : "error";
        if (failedListed < 3) {
          pages.push(emptyPage(link, "failed", code));
          failedListed++;
        }
      }
    }
    if (done < total) {
      total = done;
      await opts.onProgress?.(done, total);
    }
  } finally {
    await context.close().catch(() => {});
  }

  // Scanned pages first, in scan order; skipped and failed ones after.
  pages.sort((a, b) => Number(a.status !== "scanned") - Number(b.status !== "scanned"));

  const raw: RawScan = {
    version: 1,
    startUrl: start.toString(),
    finalUrl,
    engine: { axe: axeCore.version, userAgent: ua },
    startedAt,
    finishedAt: new Date().toISOString(),
    pages,
  };
  if (typeof builtWith === "string") raw.builtWith = builtWith;
  raw.fixVersion = 1;
  if (opts.agent) {
    raw.agent = {
      model: opts.agent.name,
      usage: pages.reduce((u, p) => (p.agent ? addUsage(u, p.agent.usage) : u), emptyUsage()),
    };
  }
  return fitPayload(raw);
}
