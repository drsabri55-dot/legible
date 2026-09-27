import { ImageResponse } from "next/og";
import { AA, INK } from "@/lib/og-logo";

// The home-screen icon: the reduced set square (stem, arm and AA) on the
// night-sky tile, as in the design's "App tile, dark".
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#161826",
      }}
    >
      <svg viewBox="0 0 40 40" width={120} height={120} fill="none" strokeWidth={3}>
        <path d="M9 6V33H31" stroke={INK} />
        <path d="M9 20H20" stroke={AA} />
      </svg>
    </div>,
    size,
  );
}
