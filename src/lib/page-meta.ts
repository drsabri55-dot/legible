import type { Metadata } from "next";

// Metadata for private pages (results, reports, account links). When the page
// turns out not to exist, the tab says so instead of naming the page that
// would have been there.
export function privatePage(title: string | null): Metadata {
  return { title: title ?? "Page not found", robots: { index: false, follow: false } };
}
