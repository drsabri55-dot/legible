// The contract between the scan worker and the site. The worker sends a
// RawScan back when it finishes; the site stores it in scans.raw and builds
// every result, report and PDF from it, so a report can be regenerated at any
// time without scanning again. Keep in step with worker/src/types.ts.

export interface RawNode {
  html: string;
  target: string[];
  failureSummary?: string;
  impact?: string | null;
  // axe-core check data, kept for colour contrast (fgColor, bgColor,
  // contrastRatio, expectedContrastRatio, fontSize, fontWeight).
  data?: Record<string, unknown> | null;
}

export interface RawRule {
  id: string;
  impact: string | null;
  help: string;
  description: string;
  helpUrl: string;
  tags: string[];
  nodeCount: number;
  nodes: RawNode[];
}

export interface RawPage {
  url: string;
  status: "scanned" | "skipped" | "failed";
  reason?: string;
  title?: string;
  violations: RawRule[];
  incomplete: RawRule[];
  passes: { id: string; nodeCount: number }[];
  inapplicable: string[];
}

export interface RawScan {
  version: 1;
  startUrl: string;
  finalUrl?: string;
  engine: { axe: string; userAgent: string };
  startedAt: string;
  finishedAt: string;
  pages: RawPage[];
}

export type ScanStatus = "queued" | "running" | "complete" | "failed";
