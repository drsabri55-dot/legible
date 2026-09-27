import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { OgLogo } from "@/lib/og-logo";

// The picture shown when a Legible link is shared (LinkedIn, WhatsApp, Slack,
// X). Built once at build time from the Nocturne colours and the moon plate.
export const alt = "Legible: every site claims to be accessible. Few are ever read as one.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const moon = await readFile(join(process.cwd(), "assets/og-moon.png"));
  const moonSrc = `data:image/png;base64,${moon.toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "linear-gradient(176deg, #1b1d2e 0%, #11121c 52%, #0a0b12 100%)",
          color: "#f3f5fe",
          padding: "64px 72px",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <img
          src={moonSrc}
          alt=""
          width={540}
          height={540}
          style={{ position: "absolute", right: -140, top: 45, opacity: 0.55, borderRadius: 9999 }}
        />
        <div style={{ display: "flex" }}>
          <OgLogo height={52} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 700 }}>
          <div style={{ fontSize: 64, lineHeight: 1.08, letterSpacing: -2 }}>
            Every site claims to be accessible. Few are ever read as one.
          </div>
          <div style={{ marginTop: 28, fontSize: 28, color: "#cfd3e5" }}>
            Legible tests your site against WCAG 2.1 AA and shows you exactly what to fix.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
