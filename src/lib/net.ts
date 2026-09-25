import "server-only";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

// Blocks server-side request forgery: a scan may only reach addresses on the
// public internet. The worker repeats this check for every request the
// browser makes, so a redirect or an embedded resource cannot slip past it.

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let ip = ipaddr.parse(address);
  if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress()) {
    ip = (ip as ipaddr.IPv6).toIPv4Address();
  }
  return ip.range() === "unicast";
}

export type HostCheck = { ok: true; addresses: string[] } | { ok: false; reason: "unresolvable" | "private" };

export async function checkPublicHost(host: string): Promise<HostCheck> {
  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: "unresolvable" };
  }
  if (!records.length) return { ok: false, reason: "unresolvable" };
  if (!records.every((r) => isPublicAddress(r.address))) return { ok: false, reason: "private" };
  return { ok: true, addresses: records.map((r) => r.address) };
}
