// Website-address checks shared by the landing form (instant feedback) and the
// scan API (the real gate). The server adds a DNS check in net.ts, because a
// public-looking name can still point at a private address.

export const SITE_ERROR = "Enter a website address, like yourbusiness.com.";

export type SiteResult = { ok: true; url: string; host: string } | { ok: false; error: string };

// The site's name as customers see it everywhere (report, PDF, emails,
// account): the host without "www.". The stored host keeps it, because rate
// limits and the block list work on the exact host.
export function siteName(host: string): string {
  return host.replace(/^www\./i, "");
}

const RESERVED_SUFFIXES = [".localhost", ".local", ".internal", ".test", ".invalid", ".onion", ".arpa", ".home", ".lan"];

export function normaliseSite(input: string, opts: { allowPrivate?: boolean } = {}): SiteResult {
  const fail: SiteResult = { ok: false, error: SITE_ERROR };
  const raw = (input || "").trim();
  if (!raw || /\s/.test(raw) || raw.length > 2048) return fail;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  if (hasScheme && !/^https?:\/\//i.test(raw)) {
    // "example.com:8080" looks like a scheme to the regex; anything else is
    // mailto:, ftp:, javascript: and the like.
    if (!/^[^/:]+\.[^/:]+:\d+/.test(raw)) return fail;
  }
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return fail;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return fail;
  if (url.username || url.password) return fail;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[") || host.includes(":");
  const isLocal = host === "localhost" || RESERVED_SUFFIXES.some((s) => host.endsWith(s));

  if (opts.allowPrivate) {
    if (!host) return fail;
  } else {
    if (url.port) return fail;
    if (isIp || isLocal) return fail;
    if (!host.includes(".")) return fail;
    const labels = host.split(".");
    if (labels.some((l) => !l || l.length > 63 || !/^[a-z0-9-]+$/.test(l) || l.startsWith("-") || l.endsWith("-"))) {
      return fail;
    }
    if (!/^(xn--[a-z0-9-]+|[a-z]{2,63})$/.test(labels[labels.length - 1])) return fail;
  }

  url.hash = "";
  return { ok: true, url: url.toString(), host };
}
