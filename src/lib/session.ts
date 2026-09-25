import "server-only";
import { cookies } from "next/headers";
import { hmac, safeEqual } from "./crypto";
import { env } from "./env";

// A signed cookie holding the signed-in email address. No server-side session
// table: the signature proves we issued it, the expiry limits its life.

const COOKIE = "legible_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function encodeSession(email: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ e: email, x: now + MAX_AGE_SECONDS * 1000 })).toString("base64url");
  return `${payload}.${hmac(`session:${payload}`)}`;
}

export function decodeSession(value: string | undefined, now = Date.now()): string | null {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig || !safeEqual(hmac(`session:${payload}`), sig)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { e?: unknown; x?: unknown };
    if (typeof data.e !== "string" || typeof data.x !== "number" || data.x < now) return null;
    return data.e;
  } catch {
    return null;
  }
}

export async function getSessionEmail(): Promise<string | null> {
  return decodeSession((await cookies()).get(COOKIE)?.value);
}

export async function startSession(email: string): Promise<void> {
  (await cookies()).set(COOKIE, encodeSession(email), {
    httpOnly: true,
    secure: env.appUrl().startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
