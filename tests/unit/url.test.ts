import { describe, expect, it } from "vitest";
import { pdfFilename } from "@/lib/fulfil";
import { normaliseSite, siteName, SITE_ERROR } from "@/lib/url";

describe("normaliseSite", () => {
  it.each([
    ["example.com", "https://example.com/", "example.com"],
    ["www.example.com", "https://www.example.com/", "www.example.com"],
    ["http://example.com", "http://example.com/", "example.com"],
    ["https://example.com/shop?x=1#top", "https://example.com/shop?x=1", "example.com"],
    ["  Example.COM  ", "https://example.com/", "example.com"],
    ["HTTPS://sub.example.co.uk/page", "https://sub.example.co.uk/page", "sub.example.co.uk"],
    ["bücher.de", "https://xn--bcher-kva.de/", "xn--bcher-kva.de"],
  ])("accepts %s", (input, url, host) => {
    expect(normaliseSite(input)).toEqual({ ok: true, url, host });
  });

  it.each([
    "",
    "   ",
    "example",
    "exa mple.com",
    "ftp://example.com",
    "mailto:me@example.com",
    "javascript:alert(1)",
    "localhost",
    "http://localhost:3000",
    "127.0.0.1",
    "http://10.0.0.5/admin",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data",
    "example.com:8080",
    "https://user:pass@example.com",
    "printer.local",
    "intranet.internal",
    "example.123",
    "-bad-.com",
  ])("rejects %j", (input) => {
    expect(normaliseSite(input)).toEqual({ ok: false, error: SITE_ERROR });
  });

  it("allows local targets only when asked (tests)", () => {
    expect(normaliseSite("http://127.0.0.1:5055/", { allowPrivate: true })).toMatchObject({ ok: true, host: "127.0.0.1" });
  });

  it("uses the approved error message", () => {
    expect(SITE_ERROR).toBe("Enter a website address, like yourbusiness.com.");
  });
});

describe("siteName", () => {
  it("drops www. so every page, email and file names the site the same way", () => {
    expect(siteName("www.w3.org")).toBe("w3.org");
    expect(siteName("shop.example.co.uk")).toBe("shop.example.co.uk");
    expect(siteName("wwwexample.com")).toBe("wwwexample.com");
  });

  it("names the PDF file after the site as the report does", () => {
    expect(pdfFilename("www.w3.org", new Date("2026-09-26T09:26:00Z"))).toBe("legible-report-w3.org-2026-09-26.pdf");
  });
});
