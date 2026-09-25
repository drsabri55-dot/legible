import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmac(value: string): string {
  return createHmac("sha256", env.sessionSecret()).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// A signed, purpose-bound value for links in emails (unsubscribe and so on).
// The purpose stops a signature made for one link being reused on another.
export function signFor(purpose: string, value: string): string {
  return hmac(`${purpose}:${value}`);
}

export function verifyFor(purpose: string, value: string, signature: string): boolean {
  return !!signature && safeEqual(signFor(purpose, value), signature);
}

export function hashIp(ip: string): string {
  return hmac(`ip:${ip}`).slice(0, 32);
}
