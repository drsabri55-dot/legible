import robotsParser from "robots-parser";
import { guardedFetch } from "./net";

export const BOT_NAME = "LegibleBot";

export interface Robots {
  isAllowed(url: string): boolean;
  crawlDelayMs: number;
}

// Reads the site's robots.txt and honours rules for LegibleBot (or for all
// bots). If there is no robots.txt, or it cannot be read, everything is allowed.
export async function loadRobots(origin: string, userAgent: string): Promise<Robots> {
  const robotsUrl = `${origin}/robots.txt`;
  let body = "";
  try {
    const res = await guardedFetch(robotsUrl, { headers: { "user-agent": userAgent }, timeoutMs: 8000 });
    if (res.ok) body = (await res.text()).slice(0, 500_000);
  } catch {
    body = "";
  }
  const parser = robotsParser(robotsUrl, body);
  const delay = parser.getCrawlDelay(BOT_NAME);
  return {
    isAllowed: (url: string) => parser.isAllowed(url, BOT_NAME) !== false,
    crawlDelayMs: Math.min(5000, Math.max(0, (typeof delay === "number" ? delay : 0) * 1000)),
  };
}
