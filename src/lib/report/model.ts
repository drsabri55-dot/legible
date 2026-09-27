// Builds everything a customer sees from the stored scan: the score, the
// counts, the free sample and the full report. Pure functions, no I/O, so the
// same raw data always gives the same report.

import type { RawNode, RawPage, RawRule, RawScan } from "@/types/scan";
import {
  CATALOGUE,
  GROUP_LABEL,
  IMPACT_ORDER,
  IMPACT_WEIGHT,
  groupForImpact,
  type Effort,
  type Impact,
  type IssueGroup,
} from "../rules/catalogue";
import { completeSnippet, suggestFix } from "../rules/fixes";
import { WCAG, criteriaFromTags } from "../rules/wcag";
import { siteName } from "../url";

export const EXAMPLES_PER_ISSUE = 5;
export const MORE_SELECTORS_PER_ISSUE = 20;

export interface IssueExample {
  pageUrl: string;
  // Other scanned pages where the same element appears (shared headers and
  // footers usually repeat on every page).
  alsoOn: number;
  selector: string;
  html: string;
  fixed: string | null;
  note: string | null;
  // Set when the element is part of content embedded from another site (a
  // YouTube player, say): that site's name. Its code is not the owner's to
  // change, so there is no corrected version.
  embeddedFrom: string | null;
}

export interface Issue {
  ruleId: string;
  title: string;
  summary: string;
  why: string;
  who: string;
  fix: string;
  effort: Effort;
  impact: Impact;
  group: IssueGroup;
  criteria: { sc: string; name: string; level: string }[];
  // Distinct elements: one repeated on several pages counts once.
  instances: number;
  pages: { url: string; count: number }[];
  examples: IssueExample[];
  moreSelectors: { pageUrl: string; selector: string; embeddedFrom: string | null }[];
  // Set when every element of the issue is known to be in content embedded
  // from other sites: their names, for example "youtube.com".
  embeddedFrom: string | null;
  genericBefore: string;
  genericAfter: string;
  helpUrl: string;
}

export type ImpactCounts = Record<Impact, number>;

export interface PageSummary {
  url: string;
  title: string | null;
  status: RawPage["status"];
  reason: string | null;
  issues: number;
}

export interface Report {
  // The address the customer entered, without www.
  site: string;
  // Set when that address redirected to a different host.
  redirectedTo: string | null;
  startUrl: string;
  scannedAt: string;
  score: number | null;
  totalIssues: number;
  counts: ImpactCounts;
  rulesFailed: number;
  rulesPassed: number;
  groups: { key: IssueGroup; label: string; issues: Issue[] }[];
  issues: Issue[];
  pages: PageSummary[];
  pagesScanned: number;
  needsReview: { ruleId: string; title: string; instances: number }[];
  engine: RawScan["engine"];
}

const IMPACTS = new Set<string>(IMPACT_ORDER);

function asImpact(value: string | null | undefined, fallback: Impact): Impact {
  return value && IMPACTS.has(value) ? (value as Impact) : fallback;
}

function worst(a: Impact, b: Impact): Impact {
  return IMPACT_ORDER.indexOf(a) <= IMPACT_ORDER.indexOf(b) ? a : b;
}

// axe gives one selector per frame level; "→" marks a step into a frame.
// Generated selectors can run to hundreds of characters; past 70, only the
// last step is shown, which is the part that names the element.
export function displaySelector(target: string[]): string {
  return target
    .map((part) => {
      if (part.length <= 70) return part;
      const steps = part.split(" > ");
      return steps.length > 1 ? `… > ${steps[steps.length - 1]}` : part;
    })
    .join(" → ");
}

function selectorOf(node: RawNode): string {
  return displaySelector(node.target);
}

function elementKey(node: RawNode): string {
  return `${node.target.join(" → ")}|${node.html}`;
}

function hostOf(url: string): string {
  try {
    return siteName(new URL(url).hostname);
  } catch {
    return url;
  }
}

// Roughly the registrable domain, so a site's own subdomains count as the
// same site: "player.vimeo.com" gives "vimeo.com", "www.bbc.co.uk" "bbc.co.uk".
const SECOND_LEVEL = /^(ac|co|com|edu|gob|gov|ltd|net|nhs|org|plc|sch)$/;
export function siteKey(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (/^[\d.]+$/.test(h) || h.includes(":")) return h;
  const labels = h.split(".");
  const n = labels.length > 2 && labels[labels.length - 1].length === 2 && SECOND_LEVEL.test(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-n).join(".");
}

// The other site an element's code comes from, or null when it is on the
// owner's own page or in a frame from their own domain.
function embeddedFrom(node: RawNode, pageUrl: string): string | null {
  if (!node.frameHost) return null;
  let pageHost: string;
  try {
    pageHost = new URL(pageUrl).hostname;
  } catch {
    return null;
  }
  return siteKey(node.frameHost) === siteKey(pageHost) ? null : siteName(node.frameHost);
}

function embedNote(from: string): string {
  return `This is part of content embedded from ${from}, so its code comes from ${from} and you cannot change it yourself. Check the embed's settings, report the problem to ${from}, or link to the content instead of embedding it.`;
}

function listOf(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
}

// Score out of 100, Lighthouse-style: every WCAG rule that applied to the site
// counts once, weighted by how badly its failure affects people. The score is
// the weighted share of those rules the site passed on every page.
export function scoreFrom(passed: Map<string, Impact>, failed: Map<string, Impact>): number | null {
  let pass = 0;
  let fail = 0;
  for (const impact of passed.values()) pass += IMPACT_WEIGHT[impact];
  for (const impact of failed.values()) fail += IMPACT_WEIGHT[impact];
  if (pass + fail === 0) return null;
  return Math.round((100 * pass) / (pass + fail));
}

export function buildReport(raw: RawScan): Report {
  const scanned = raw.pages.filter((p) => p.status === "scanned");
  const failedRules = new Map<string, Impact>();
  const passedRules = new Map<string, Impact>();
  const byRule = new Map<string, { rule: RawRule; impact: Impact; hits: { page: RawPage; rule: RawRule }[] }>();

  for (const page of scanned) {
    for (const rule of page.violations) {
      const fallback = CATALOGUE[rule.id]?.impact ?? "moderate";
      let impact = asImpact(rule.impact, fallback);
      for (const n of rule.nodes) impact = worst(impact, asImpact(n.impact, impact));
      const entry = byRule.get(rule.id);
      if (entry) {
        entry.impact = worst(entry.impact, impact);
        entry.hits.push({ page, rule });
      } else {
        byRule.set(rule.id, { rule, impact, hits: [{ page, rule }] });
      }
    }
  }
  for (const [id, entry] of byRule) failedRules.set(id, entry.impact);
  for (const page of scanned) {
    for (const p of page.passes) {
      if (failedRules.has(p.id)) continue;
      passedRules.set(p.id, CATALOGUE[p.id]?.impact ?? "moderate");
    }
  }

  const counts: ImpactCounts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const issues: Issue[] = [];

  for (const [ruleId, { rule, impact, hits }] of byRule) {
    const info = CATALOGUE[ruleId];

    // The same element on several pages (a shared header, say) is one thing
    // to fix. Only stored nodes can be compared; elements beyond the stored
    // sample are counted as distinct.
    const byElement = new Map<string, { node: RawNode; pages: string[] }>();
    let repeats = 0;
    for (const { page, rule: r } of hits) {
      for (const node of r.nodes) {
        const key = elementKey(node);
        const seen = byElement.get(key);
        if (seen) {
          if (!seen.pages.includes(page.url)) {
            seen.pages.push(page.url);
            repeats++;
          }
        } else {
          byElement.set(key, { node, pages: [page.url] });
        }
      }
    }
    const instances = hits.reduce((sum, h) => sum + h.rule.nodeCount, 0) - repeats;
    counts[impact] += instances;

    const examples: IssueExample[] = [];
    const moreSelectors: { pageUrl: string; selector: string; embeddedFrom: string | null }[] = [];
    const embeds = new Set<string>();
    let ownElements = 0;
    for (const { node, pages: on } of byElement.values()) {
      const from = embeddedFrom(node, on[0]);
      if (from) embeds.add(from);
      else ownElements++;
      if (examples.length < EXAMPLES_PER_ISSUE) {
        const html = completeSnippet(node.html);
        const fix = from ? null : suggestFix(ruleId, { ...node, html });
        examples.push({
          pageUrl: on[0],
          alsoOn: on.length - 1,
          selector: selectorOf(node),
          html,
          fixed: fix?.code ?? null,
          note: from ? embedNote(from) : (fix?.note ?? null),
          embeddedFrom: from,
        });
      } else if (moreSelectors.length < MORE_SELECTORS_PER_ISSUE) {
        moreSelectors.push({ pageUrl: on[0], selector: selectorOf(node), embeddedFrom: from });
      }
    }
    // Only elements axe kept can be checked, so a whole issue is called
    // embedded only when none were left out.
    const allKept = hits.every((h) => h.rule.nodes.length === h.rule.nodeCount);

    issues.push({
      ruleId,
      title: info?.title ?? rule.help,
      summary: info?.summary ?? rule.description,
      why: info?.why ?? "This stops some people from using the page as intended.",
      who: info?.who ?? "People who use assistive technology",
      fix: info?.fix ?? `See the guidance at ${rule.helpUrl}`,
      effort: info?.effort ?? "moderate",
      impact,
      group: groupForImpact(impact),
      criteria: criteriaFromTags(rule.tags).map((sc) => ({ sc, name: WCAG[sc].name, level: WCAG[sc].level })),
      instances,
      pages: hits.map((h) => ({ url: h.page.url, count: h.rule.nodeCount })),
      examples,
      moreSelectors,
      embeddedFrom: allKept && ownElements === 0 && embeds.size > 0 ? listOf([...embeds]) : null,
      genericBefore: info?.before ?? "",
      genericAfter: info?.after ?? "",
      helpUrl: rule.helpUrl,
    });
  }

  // Worst first; within a level, the issue affecting the most elements first.
  issues.sort(
    (a, b) =>
      IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact) ||
      b.instances - a.instances ||
      a.title.localeCompare(b.title),
  );

  const groups = (["must", "should", "nice"] as IssueGroup[]).map((key) => ({
    key,
    label: GROUP_LABEL[key],
    issues: issues.filter((i) => i.group === key),
  }));

  const review = new Map<string, number>();
  for (const page of scanned) {
    for (const r of page.incomplete) review.set(r.id, (review.get(r.id) ?? 0) + r.nodeCount);
  }
  const needsReview = [...review]
    .filter(([id]) => !byRule.has(id))
    .map(([ruleId, instances]) => ({
      ruleId,
      title: CATALOGUE[ruleId]?.title ?? ruleId,
      instances,
    }))
    .sort((a, b) => b.instances - a.instances);

  const pages: PageSummary[] = raw.pages.map((p) => ({
    url: p.url,
    title: p.title ?? null,
    status: p.status,
    reason: p.reason ?? null,
    issues: p.violations.reduce((sum, r) => sum + r.nodeCount, 0),
  }));

  const site = hostOf(raw.startUrl);
  const landed = raw.finalUrl ? hostOf(raw.finalUrl) : site;
  return {
    site,
    redirectedTo: landed !== site ? landed : null,
    startUrl: raw.startUrl,
    scannedAt: raw.finishedAt,
    score: scoreFrom(passedRules, failedRules),
    totalIssues: IMPACT_ORDER.reduce((sum, k) => sum + counts[k], 0),
    counts,
    rulesFailed: failedRules.size,
    rulesPassed: passedRules.size,
    groups,
    issues,
    pages,
    pagesScanned: scanned.length,
    needsReview,
    engine: raw.engine,
  };
}

// What the free result page shows: the score, the counts and two issues in
// full. Stored in scans.summary so the free page never loads the raw data.
export interface FreeSummary {
  site: string;
  redirectedTo?: string | null;
  score: number | null;
  totalIssues: number;
  counts: ImpactCounts;
  issueTypes: number;
  pagesScanned: number;
  pages: PageSummary[];
  samples: Issue[];
  groupCounts: Record<IssueGroup, number>;
  // Missing from summaries stored before it was added.
  needsReview?: Report["needsReview"];
}

// A scan with no failures has no report to sell: it would only repeat the
// free result.
export function reportForSale(summary: FreeSummary | null): boolean {
  return !!summary && summary.totalIssues > 0;
}

export function freeSummary(report: Report): FreeSummary {
  return {
    site: report.site,
    redirectedTo: report.redirectedTo,
    score: report.score,
    totalIssues: report.totalIssues,
    counts: report.counts,
    issueTypes: report.issues.length,
    pagesScanned: report.pagesScanned,
    pages: report.pages,
    // Issues the owner can fix come first: the sample shows what they will do.
    samples: [...report.issues.filter((i) => !i.embeddedFrom), ...report.issues.filter((i) => i.embeddedFrom)]
      .slice(0, 2)
      .map((i) => ({ ...i, examples: i.examples.slice(0, 1), moreSelectors: [] })),
    groupCounts: {
      must: report.groups[0].issues.length,
      should: report.groups[1].issues.length,
      nice: report.groups[2].issues.length,
    },
    needsReview: report.needsReview,
  };
}
