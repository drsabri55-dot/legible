import type { ImpactCounts } from "@/lib/report/model";

const ROWS: { key: keyof ImpactCounts; label: string; fill: string }[] = [
  { key: "critical", label: "Critical", fill: "var(--color-accent-400)" },
  { key: "serious", label: "Serious", fill: "var(--color-accent-2-500)" },
  { key: "moderate", label: "Moderate", fill: "var(--color-neutral-600)" },
  { key: "minor", label: "Minor", fill: "var(--color-neutral-700)" },
];

// Chapter 05's bars, with real numbers.
export function SeverityBars({ counts }: { counts: ImpactCounts }) {
  const total = Math.max(1, ROWS.reduce((sum, r) => sum + counts[r.key], 0));
  return (
    <ul className="m-0 flex max-w-[40rem] list-none flex-col gap-4 p-0">
      {ROWS.filter((row) => row.key !== "minor" || counts.minor > 0).map((row) => (
        <li key={row.key} className="grid grid-cols-[96px_minmax(0,1fr)_44px] items-center gap-[14px]">
          <span className="text-[14px] text-nc-neutral-300">{row.label}</span>
          <span aria-hidden="true" className="block h-[2px] rounded-[2px] bg-white/10">
            <span
              className="block h-[2px] origin-left rounded-[2px]"
              style={{ background: row.fill, transform: `scaleX(${counts[row.key] / total})` }}
            />
          </span>
          <span className="text-right text-[14px] tabular-nums text-nc-neutral-200">{counts[row.key]}</span>
        </li>
      ))}
    </ul>
  );
}
