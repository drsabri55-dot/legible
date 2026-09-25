import { describe, expect, it } from "vitest";
import { signFor, verifyFor } from "@/lib/crypto";
import { decodeSession, encodeSession } from "@/lib/session";

describe("session cookie", () => {
  it("round-trips and expires", () => {
    const now = Date.now();
    const value = encodeSession("owner@example.com", now);
    expect(decodeSession(value, now)).toBe("owner@example.com");
    expect(decodeSession(value, now + 31 * 24 * 3600 * 1000)).toBeNull();
  });

  it("rejects tampering", () => {
    const value = encodeSession("owner@example.com");
    const [payload, sig] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ e: "attacker@example.com", x: Date.now() + 1e9 })).toString("base64url");
    expect(decodeSession(`${forged}.${sig}`)).toBeNull();
    expect(decodeSession(`${payload}.${sig.slice(0, -2)}xx`)).toBeNull();
    expect(decodeSession("garbage")).toBeNull();
    expect(decodeSession(undefined)).toBeNull();
  });
});

describe("signed links", () => {
  it("binds a signature to its purpose", () => {
    const sig = signFor("unsubscribe", "a@example.com");
    expect(verifyFor("unsubscribe", "a@example.com", sig)).toBe(true);
    expect(verifyFor("unsubscribe", "b@example.com", sig)).toBe(false);
    expect(verifyFor("other", "a@example.com", sig)).toBe(false);
    expect(verifyFor("unsubscribe", "a@example.com", "")).toBe(false);
  });
});
