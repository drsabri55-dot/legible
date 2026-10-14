"use client";

import { useState } from "react";
import type { LiveState } from "@/lib/live";
import { LIVE, frameAlt, pageStateText } from "./wording";

type Live = NonNullable<LiveState["live"]>;
const SHOWN = 5;

// The agent's latest picture, the pages and the latest steps. Pause freezes
// what is shown (WCAG 2.2.2); the page keeps polling so the result still
// appears. Nothing here is a live region: only the progress line above it is.
export function LiveView({ live }: { live: Live }) {
  const [paused, setPaused] = useState<Live | null>(null);
  const [all, setAll] = useState(false);
  const shown = paused ?? live;
  const steps = all ? shown.steps : shown.steps.slice(0, SHOWN);
  return (
    <section aria-labelledby="live" className="mt-14">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h2 id="live" className="m-0 text-[clamp(22px,2.4vw,28px)] leading-[1.2] tracking-[-0.02em]">{LIVE.heading}</h2>
          <p className="mt-2 mb-0 max-w-[58ch] text-[15px] leading-[1.8] text-nc-neutral-300">{LIVE.intro}</p>
        </div>
        <button type="button" className="btn btn-secondary min-h-[32px]" aria-pressed={!!paused} onClick={() => setPaused(paused ? null : live)}>
          {paused ? LIVE.resume : LIVE.pause}
        </button>
      </div>
      <div className="mt-6 grid gap-7 md:grid-cols-[minmax(0,1fr)_15rem] md:items-start">
        <figure className="m-0">
          {shown.frame && shown.latest ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown.frame} alt={frameAlt(shown.latest.title, shown.latest.step, shown.latest.note)}
              className="block aspect-[1280/800] w-full rounded-[10px] bg-nc-surface shadow-[0_0_0_1px_#595d6c] motion-safe:transition-opacity" />
          ) : (
            <p className="m-0 rounded-[10px] bg-nc-surface p-6 text-[14px] text-nc-neutral-400">{LIVE.noFrame}</p>
          )}
          {shown.latest && (
            <figcaption className="mt-3 text-[14px] leading-[1.7] text-nc-neutral-300">
              <span className="tabular-nums text-nc-accent-300">Step {shown.latest.step}</span> · {shown.latest.note}
            </figcaption>
          )}
        </figure>
        <div>
          <h3 className="m-0 text-[13px] font-medium uppercase tracking-[0.14em] text-nc-neutral-400">{LIVE.pages}</h3>
          <ol className="mt-3 mb-0 list-none p-0">
            {shown.pages.map((p) => (
              <li key={p.n} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-[6px] border-t border-white/[0.07] py-[10px]">
                <span className="text-[13px] tabular-nums text-nc-neutral-500">{p.n}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] text-nc-neutral-100">{p.title || `Page ${p.n}`}</span>
                  <span className={`block text-[13px] ${p.state === "now" ? "text-nc-accent-300" : "text-nc-neutral-400"}`}>{pageStateText(p)}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      {shown.steps.length > 0 && (
        <div className="mt-7">
          <h3 className="m-0 text-[13px] font-medium uppercase tracking-[0.14em] text-nc-neutral-400">{LIVE.steps}</h3>
          <ol className="mt-3 mb-0 list-none p-0">
            {steps.map((s) => (
              <li key={s.step} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2 border-t border-white/[0.07] py-[9px] text-[14px] leading-[1.6] sm:grid-cols-[2.5rem_5.5rem_minmax(0,1fr)]">
                <span className="tabular-nums text-nc-accent-300">{s.step}</span>
                <span className="hidden truncate text-nc-neutral-400 sm:block">{s.title ?? ""}</span>
                <span className="text-nc-neutral-200">{s.note}</span>
              </li>
            ))}
          </ol>
          {!all && shown.steps.length > SHOWN && (
            <button type="button" className="mt-2 min-h-[24px] text-[13.5px] text-nc-accent-300 underline underline-offset-[3px]" onClick={() => setAll(true)}>
              {LIVE.showAll(shown.steps.length)}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
