import "server-only";
import { hashIp } from "./crypto";
import {
  countActiveScans,
  countScansByHost,
  countScansByIp,
  createScan,
  failScan,
  isBlockedHost,
} from "./data";
import { alertOwner } from "./email/send";
import { env } from "./env";
import { checkPublicHost } from "./net";
import { freeAgentMode } from "./spend";
import { normaliseSite, SITE_ERROR } from "./url";
import { WorkerBusyError, dispatchScan } from "./worker";

export const LIMITS = {
  perIpShort: { count: 5, minutes: 10 },
  perIpDay: { count: 20, minutes: 60 * 24 },
  perHostHour: { count: 6, minutes: 60 },
  activeScans: 30,
};

export const MESSAGES = {
  invalid: SITE_ERROR,
  unresolvable: "We could not find that website. Check the address and try again.",
  blocked: "The owner of this site has asked us not to scan it.",
  tooManyFromYou: "You have started several scans in a short time. Try again in a few minutes.",
  tooManyForSite: "This site has been scanned several times in the last hour. Try again later.",
  busy: "Our scanner is busy right now. Try again in a minute.",
  down: "Our scanner is not responding. Try again in a few minutes.",
};

export type StartResult = { ok: true; id: string } | { ok: false; status: number; error: string };

export async function startScan(input: string, ip: string): Promise<StartResult> {
  const allowPrivate = env.allowPrivateTargets();
  const site = normaliseSite(input, { allowPrivate });
  if (!site.ok) return { ok: false, status: 400, error: MESSAGES.invalid };

  if (await isBlockedHost(site.host)) return { ok: false, status: 403, error: MESSAGES.blocked };

  const ipHash = hashIp(ip);
  if ((await countScansByIp(ipHash, LIMITS.perIpShort.minutes)) >= LIMITS.perIpShort.count) {
    return { ok: false, status: 429, error: MESSAGES.tooManyFromYou };
  }
  if ((await countScansByIp(ipHash, LIMITS.perIpDay.minutes)) >= LIMITS.perIpDay.count) {
    return { ok: false, status: 429, error: MESSAGES.tooManyFromYou };
  }
  if ((await countScansByHost(site.host, LIMITS.perHostHour.minutes)) >= LIMITS.perHostHour.count) {
    return { ok: false, status: 429, error: MESSAGES.tooManyForSite };
  }
  if ((await countActiveScans()) >= LIMITS.activeScans) return { ok: false, status: 503, error: MESSAGES.busy };

  if (!allowPrivate) {
    const check = await checkPublicHost(site.host);
    if (!check.ok) {
      return { ok: false, status: 400, error: check.reason === "unresolvable" ? MESSAGES.unresolvable : MESSAGES.invalid };
    }
  }

  // The testing agent runs on free scans while today's spending is under the cap.
  const agent = await freeAgentMode();
  const scan = await createScan({ url: site.url, host: site.host, ipHash, agent });
  try {
    await dispatchScan({ id: scan.id, url: scan.url, agent: agent === "on" });
  } catch (e) {
    const busy = e instanceof WorkerBusyError;
    await failScan(scan.id, busy ? "busy" : "worker_unavailable");
    if (!busy) await alertOwner("The scan worker is not responding", String((e as Error).message));
    return { ok: false, status: 503, error: busy ? MESSAGES.busy : MESSAGES.down };
  }
  return { ok: true, id: scan.id };
}

// What the result page says when a scan fails. Keys are the error codes the
// worker and the site store in scans.error.
export function failureMessage(code: string | null): string {
  switch (code) {
    case "unresolvable":
      return MESSAGES.unresolvable;
    case "not_found":
      return "That address answered \u201cpage not found\u201d. Check it, or enter just the site\u2019s main address, like yourbusiness.com.";
    case "refused":
      return "The site turned our scanner away. Some sites block automated visitors, so we could not read it. If it is your site, allow LegibleBot in its security settings and try again.";
    case "robots":
      return "This site's robots.txt asks automated tools not to visit its home page, so we did not scan it.";
    case "unreachable":
      return "We could not load the site. Check the address, or try again if the site was down.";
    case "timeout":
      return "The scan took too long and was stopped. The site may be slow. Try again in a few minutes.";
    case "busy":
      return MESSAGES.busy;
    case "worker_unavailable":
      return MESSAGES.down;
    case "blocked_target":
      return "This address points somewhere we cannot scan. Enter a public website.";
    case "not_html":
      return "That address did not return a web page.";
    default:
      return "Something went wrong during the scan. Try again, and if it keeps happening, reply to any Legible email.";
  }
}
