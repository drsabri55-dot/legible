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
  // For an element inside a frame (target has more than one selector): the
  // host of the page loaded in that frame, such as www.youtube.com.
  frameHost?: string;
  // A screenshot of the element, taken by the testing agent. The site stores
  // the image in scan_shots under this id.
  shot?: string;
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
  // What the testing agent did on this page. Missing when it did not run.
  agent?: AgentPageResult;
}

export interface RawScan {
  version: 1;
  startUrl: string;
  finalUrl?: string;
  engine: { axe: string; userAgent: string };
  startedAt: string;
  finishedAt: string;
  pages: RawPage[];
  // Set when the testing agent ran: the model and the tokens it used.
  agent?: { model: string; usage: AgentUsage };
}

export type ScanStatus = "queued" | "running" | "complete" | "failed";

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type AgentReviewKind = "image-description" | "link-purpose" | "heading-fit" | "error-help" | "captions";

// A judgement finding both AI passes agreed on. Never counted in the score.
export interface AgentReview {
  kind: AgentReviewKind;
  selector: string;
  html: string;
  reason: string;
  shot?: string;
}

export interface AgentPageResult {
  status: "tested" | "partly" | "failed" | "off";
  // "step limit", "time limit", "model error", "declined"
  reason?: string;
  steps: number;
  reviews: AgentReview[];
  usage: AgentUsage;
}
