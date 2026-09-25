"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Status {
  status: "queued" | "running" | "complete" | "failed";
  pagesDone: number;
  pagesTotal: number | null;
  error: string | null;
}

// Polls the scan until it finishes, then asks the server to render the result.
export function ScanProgress({ scanId, host, initial }: { scanId: string; host: string; initial: Status }) {
  const router = useRouter();
  const [s, setS] = useState<Status>(initial);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const started = Date.now();
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/scans/${scanId}`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as Status;
          if (stop) return;
          setS(next);
          if (next.status === "complete" || next.status === "failed") {
            router.refresh();
            return;
          }
        }
      } catch {
        // Network blip: try again on the next tick.
      }
      if (Date.now() - started > 90_000) setSlow(true);
      if (!stop) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 1500);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [scanId, router]);

  const total = s.pagesTotal ?? 6;
  const done = s.status === "queued" ? 0 : Math.min(s.pagesDone, total);
  const pct = s.status === "queued" ? 0.04 : Math.max(0.08, done / total);
  const label =
    s.status === "queued"
      ? "Waiting for a free scanner…"
      : s.pagesTotal
        ? `Reading page ${Math.min(done + 1, total)} of ${total}`
        : "Reading the home page";

  return (
    <div>
      <p className="m-0 text-[15px] text-nc-neutral-300" aria-live="polite">
        {s.status === "complete" ? "Done. Loading your result…" : label}
      </p>
      <div
        className="mt-4 h-[2px] w-full max-w-[30rem] rounded-[2px] bg-white/10"
        role="progressbar"
        aria-label="Scan progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct * 100)}
      >
        <div
          className="h-[2px] origin-left rounded-[2px] bg-nc-accent-400 transition-transform duration-700"
          style={{ transform: `scaleX(${pct})` }}
        />
      </div>
      <p className="mt-6 max-w-[46ch] text-[14px] leading-[1.8] text-nc-neutral-400">
        Legible loads {host} in a real browser, checks every link, label, image and colour pair on each page, then
        moves to the next page after a short pause. Most scans take under a minute.
      </p>
      {slow && (
        <p className="mt-3 text-[14px] text-nc-neutral-300">
          This is taking longer than usual. You can leave this page open; the result will appear when it is ready.
        </p>
      )}
    </div>
  );
}
