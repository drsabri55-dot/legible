import { describe, expect, it } from "vitest";
import { isPublicAddress, resolvesPublic } from "../src/net";

describe("SSRF guard", () => {
  it("blocks private, loopback, link-local and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.0.0.1", "192.168.0.10", "172.20.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:192.168.0.1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    expect(isPublicAddress("1.1.1.1")).toBe(true);
  });

  it("treats literal IPs and localhost names by what they are", async () => {
    expect(await resolvesPublic("127.0.0.1")).toBe(false);
    expect(await resolvesPublic("[::1]")).toBe(false);
    expect(await resolvesPublic("localhost")).toBe(false);
    expect(await resolvesPublic("no-such-host.invalid")).toBe(false);
  });
});
