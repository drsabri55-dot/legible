// The set-square logo for images drawn with next/og (share images, the home
// screen icon). Plain colours: those images cannot read the CSS variables.
export const INK = "#f3f5fe";
export const AA = "#968ae0"; // accent-500, as in Logo.tsx

export function OgLogo({ height }: { height: number }) {
  const line = Math.round((1.6 * height) / 25.9);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: Math.round(height * 0.3), borderBottom: `${line}px solid ${INK}` }}>
      <svg viewBox="8.3 6 13 25.9" width={height / 2} height={height} fill="none" strokeWidth={(line * 25.9) / height}>
        <path d="M9 6V31.9" stroke={INK} />
        <path d="M9 12H21" stroke={INK} />
        <path d="M9 20H18" stroke={AA} />
        <path d="M9 28H14" stroke={INK} />
      </svg>
      <div style={{ fontSize: Math.round(height * 0.7), lineHeight: 1, paddingBottom: Math.round(height * 0.7 * 0.22), color: INK }}>
        Legible
      </div>
    </div>
  );
}
