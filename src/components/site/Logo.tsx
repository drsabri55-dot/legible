import type { CSSProperties } from "react";

// The set square from the design project's "Legible Logo.dc.html": a stem
// carrying the three WCAG levels as graduations (AAA, AA, A from the top) and
// the arm it stands on. AA, the level every report measures to, is the only
// line in the accent colour. Lines use currentColor, so the logo takes the
// colour of the text around it. The wordmark is the site's own face.
const AA: CSSProperties = { stroke: "var(--color-accent-500)" };

// The horizontal logo: the arm leaves the mark and becomes the rule under
// the word. `height` is the stem's height in pixels.
export function Logo({ height = 24 }: { height?: number }) {
  // One line weight for stem, graduations and rule: 1.6 units of the stem.
  const line = Math.max(1.25, Math.round(((1.6 * height) / 25.9) * 4) / 4);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "flex-end",
        gap: Math.round(height * 0.3),
        borderBottom: `${line}px solid currentColor`,
      }}
    >
      <svg
        viewBox="8.3 6 13 25.9"
        width={height / 2}
        height={height}
        fill="none"
        stroke="currentColor"
        strokeWidth={(line * 25.9) / height}
        aria-hidden="true"
        focusable="false"
        style={{ display: "block", flex: "none" }}
      >
        <path d="M9 6V31.9" />
        <path d="M9 12H21" />
        <path d="M9 20H18" style={AA} />
        <path d="M9 28H14" />
      </svg>
      <span style={{ display: "block", fontSize: Math.round(height * 0.7), lineHeight: 1, paddingBottom: "0.22em" }}>
        Legible
      </span>
    </span>
  );
}
