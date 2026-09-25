// A score out of 100 as a ring. The number is the accessible content; the
// ring is decoration.
export function ScoreRing({ score, size = 148 }: { score: number | null; size?: number }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const value = score ?? 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" className="-rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(233,233,237,0.1)" strokeWidth="3" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="var(--color-accent-400)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${(c * value) / 100} ${c}`}
          style={{ filter: "drop-shadow(0 0 6px rgba(145,132,217,0.45))" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[40px] font-medium leading-none tracking-[-0.04em] tabular-nums text-nc-neutral-100">
          {score ?? "–"}
        </span>
        <span className="mt-1 text-[11px] uppercase tracking-[0.18em] text-nc-neutral-400">out of 100</span>
      </div>
    </div>
  );
}
