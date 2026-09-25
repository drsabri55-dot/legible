import { describe, expect, it } from "vitest";
import { isPublicAddress } from "@/lib/net";

describe("isPublicAddress", () => {
  it.each(["93.184.216.34", "8.8.8.8", "2606:2800:220:1:248:1893:25c8:1946"])("allows public %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});
