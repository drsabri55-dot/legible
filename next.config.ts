import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The end-to-end tests build into their own folder so they never disturb
  // a running `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Email templates are read from disk at run time; make sure Vercel ships them.
  outputFileTracingIncludes: {
    "/*": ["./emails/**/*.html"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Reports and results are private links: keep them out of search engines.
      { source: "/report/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/scan/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
