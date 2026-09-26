import type { Impact } from "@/lib/rules/catalogue";

const STYLE: Record<Impact, { label: string; color: string }> = {
  critical: { label: "Critical", color: "var(--color-critical)" },
  serious: { label: "Serious", color: "var(--color-serious)" },
  moderate: { label: "Moderate", color: "var(--color-moderate)" },
  minor: { label: "Minor", color: "var(--color-minor)" },
};

export function ImpactTag({ impact }: { impact: Impact }) {
  const s = STYLE[impact];
  return (
    <span
      className="inline-flex items-center gap-[6px] rounded-[6px] border px-[8px] py-[2px] text-[12px] tracking-[0.04em]"
      style={{ borderColor: `color-mix(in srgb, ${s.color} 45%, transparent)`, color: s.color }}
    >
      <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full" style={{ background: s.color }} />
      {s.label}
    </span>
  );
}
