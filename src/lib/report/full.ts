// The paid whole-site test: its limits, and one report from the free scan's
// pages plus the pages the worker sent one by one. Pure, like buildReport.
import type { RawPage, RawScan } from "@/types/scan";

// Pages in all, counting the free scan's, and AI-written fixes per report.
export const FULL_REPORT_PAGES = 50;
export const AI_FIXES_PER_REPORT = 300;

// The same page by another spelling: case of the host, a trailing slash, a #part.
function addressKey(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : u.pathname;
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return url;
  }
}

export function mergeFullPages(raw: RawScan, extra: RawPage[]): RawScan {
  const scanned = raw.pages.filter((p) => p.status === "scanned");
  const others = raw.pages.filter((p) => p.status !== "scanned");
  const seen = new Set(scanned.map((p) => addressKey(p.url)));
  const added: RawPage[] = [];
  for (const p of extra) {
    const key = addressKey(p.url);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(p);
  }
  return { ...raw, pages: [...scanned, ...added, ...others] };
}

export function aiFixesUsed(pages: RawPage[]): number {
  let n = 0;
  for (const p of pages) for (const r of p.violations) for (const node of r.nodes) if (node.fix?.source === "ai") n++;
  return n;
}
