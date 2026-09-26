import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

// Server-side request forgery guard. Every request the browser or the worker
// makes goes through isAllowedHost, so neither the site, its redirects nor its
// embedded resources can make us reach a private network or cloud metadata.
// Keep in step with src/lib/net.ts in the site.

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let ip = ipaddr.parse(address);
  if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress()) {
    ip = (ip as ipaddr.IPv6).toIPv4Address();
  }
  return ip.range() === "unicast";
}

export type HostKind = "public" | "private" | "unresolvable";

// "unresolvable" (no such website) is told apart from "private" so the
// customer gets the right message.
export async function classifyHost(hostname: string): Promise<HostKind> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (ipaddr.isValid(host)) return isPublicAddress(host) ? "public" : "private";
  try {
    const records = await lookup(host, { all: true, verbatim: true });
    if (!records.length) return "unresolvable";
    return records.every((r) => isPublicAddress(r.address)) ? "public" : "private";
  } catch {
    return "unresolvable";
  }
}

export async function resolvesPublic(hostname: string): Promise<boolean> {
  return (await classifyHost(hostname)) === "public";
}

export function allowPrivateTargets(): boolean {
  return process.env.ALLOW_PRIVATE_TARGETS === "1";
}

export function makeHostGuard() {
  const cache = new Map<string, Promise<boolean>>();
  return (hostname: string): Promise<boolean> => {
    if (allowPrivateTargets()) return Promise.resolve(true);
    let hit = cache.get(hostname);
    if (!hit) {
      hit = resolvesPublic(hostname);
      cache.set(hostname, hit);
    }
    return hit;
  };
}

// fetch() with the same guard applied to the first request and every redirect.
export async function guardedFetch(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
  guard = makeHostGuard(),
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(current);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("blocked_target");
    if (!(await guard(u.hostname))) throw new Error("blocked_target");
    const res = await fetch(current, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("too_many_redirects");
}
