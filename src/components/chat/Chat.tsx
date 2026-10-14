"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckoutButton } from "@/components/results/CheckoutButton";
import { answerParts } from "@/lib/chat/links";
import { markChatBusy, waitingForAnswer } from "./state";
import { CHAT, chatIntro, errorText, leftText, privacyText, suggestions, type ChatPlace } from "./wording";

type Mode = "open" | "used" | "paused" | "off";
type Message = { id: number; role: "user" | "assistant"; body: string };

export interface ChatInitial {
  mode: Mode;
  paid: boolean;
  limit: number;
  left: number;
  messages: Message[];
}

// Questions about one scan. Answers are plain text with links only to
// anchors on this page; the newest answer is read out by a polite live
// region, and focus stays in the question box (or moves to the notice that
// replaces it). While a question is in flight or typed, the scanning page
// waits before showing the result, and a question whose answer was still
// being written when the page changed is picked up again.
export function Chat({
  scanId,
  place,
  anchors,
  offer,
  initial,
  reportToken,
}: {
  scanId: string;
  // The report's own token: opens the paid chat (on the report page only).
  reportToken?: string;
  place: ChatPlace;
  anchors: string[];
  offer: { label: string } | null;
  initial: ChatInitial;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [left, setLeft] = useState(initial.left);
  const [messages, setMessages] = useState<Message[]>(initial.messages);
  const [value, setValue] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<{ code: string; question: string } | null>(null);
  const [announce, setAnnounce] = useState("");
  const [waiting, setWaiting] = useState(() => waitingForAnswer(initial.messages));
  const notice = useRef<HTMLDivElement>(null);
  const focusNotice = useRef(false);
  const { heading, intro } = chatIntro(place, initial.limit);
  const known = new Set(anchors);
  const headingId = `${id}-ask`;
  const query = reportToken ? `?report=${encodeURIComponent(reportToken)}` : "";

  useEffect(() => {
    markChatBusy(id, !!sending || waiting || value.trim() !== "");
    return () => markChatBusy(id, false);
  }, [id, sending, waiting, value]);

  // The answer to a question asked before this page re-rendered.
  useEffect(() => {
    if (!waiting) return;
    let tries = 0;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const res = await fetch(`/api/scans/${scanId}/chat${query}`, { cache: "no-store" });
        const data = (await res.json()) as ChatInitial;
        if (!stop && res.ok && !waitingForAnswer(data.messages)) {
          setMessages(data.messages);
          setLeft(data.left);
          setMode(data.mode);
          setAnnounce(data.messages.at(-1)?.body ?? "");
          setWaiting(false);
          return;
        }
      } catch {
        // Try again on the next tick.
      }
      if (!stop && ++tries < 20) timer = setTimeout(check, 2000);
      else if (!stop) setWaiting(false);
    };
    timer = setTimeout(check, 1000);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [waiting, scanId, query]);

  // When the box gives way to a notice, focus goes to the notice.
  useEffect(() => {
    if (focusNotice.current && mode !== "open") {
      focusNotice.current = false;
      notice.current?.focus();
    }
  }, [mode]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || sending) return;
    setError(null);
    setSending(q);
    setValue("");
    try {
      const res = await fetch(`/api/scans/${scanId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, ...(reportToken ? { report: reportToken } : {}) }),
      });
      const data = (await res.json().catch(() => ({}))) as { answer?: string; left?: number; code?: string };
      if (res.ok && data.answer) {
        const now = Date.now();
        setMessages((m) => [
          ...m,
          { id: now, role: "user", body: q },
          { id: now + 1, role: "assistant", body: data.answer! },
        ]);
        setLeft(data.left ?? Math.max(0, left - 1));
        if ((data.left ?? 1) === 0) {
          focusNotice.current = true;
          setMode("used");
        }
        setAnnounce(data.answer);
      } else if (data.code === "used" || data.code === "paused") {
        focusNotice.current = true;
        setMode(data.code);
      } else {
        setError({ code: data.code ?? "failed", question: q });
      }
    } catch {
      setError({ code: "failed", question: q });
    } finally {
      setSending(null);
      if (!focusNotice.current) input.current?.focus();
    }
  }

  if (mode === "off") return null;
  return (
    <section aria-labelledby={headingId} className="mt-16">
      <h2 id={headingId} className="m-0 text-[clamp(22px,2.4vw,28px)] leading-[1.2] tracking-[-0.02em]">
        {heading}
      </h2>
      <p className="mt-3 mb-0 max-w-[58ch] text-[15px] leading-[1.8] text-nc-neutral-300">{intro}</p>
      <div className="mt-6 max-w-[46rem]">
        {(messages.length > 0 || sending) && (
          <ol className="m-0 list-none p-0">
            {messages.map((m) => (
              <li key={m.id} className="border-t border-white/[0.07] py-4">
                <span
                  className={`text-[12px] uppercase tracking-[0.14em] ${m.role === "user" ? "text-nc-neutral-500" : "text-nc-accent-300"}`}
                >
                  {m.role === "user" ? CHAT.you : CHAT.legible}
                </span>
                <p
                  className={`mt-[6px] mb-0 max-w-[62ch] text-[15px] leading-[1.75] ${m.role === "user" ? "text-nc-neutral-100" : "text-nc-neutral-200"}`}
                >
                  {m.role === "user"
                    ? m.body
                    : answerParts(m.body, known).map((p, i) =>
                        "href" in p ? (
                          <a key={i} href={p.href}>
                            {p.text}
                          </a>
                        ) : (
                          <span key={i}>{p.text}</span>
                        ),
                      )}
                </p>
              </li>
            ))}
            {waiting && !sending && (
              <li className="border-t border-white/[0.07] py-4">
                <span className="text-[12px] uppercase tracking-[0.14em] text-nc-accent-300">{CHAT.legible}</span>
                <p className="mt-[6px] mb-0 text-[14.5px] text-nc-neutral-400">{CHAT.writing}</p>
              </li>
            )}
            {sending && (
              <>
                <li className="border-t border-white/[0.07] py-4">
                  <span className="text-[12px] uppercase tracking-[0.14em] text-nc-neutral-500">{CHAT.you}</span>
                  <p className="mt-[6px] mb-0 text-[15px] leading-[1.75] text-nc-neutral-100">{sending}</p>
                </li>
                <li className="border-t border-white/[0.07] py-4">
                  <span className="text-[12px] uppercase tracking-[0.14em] text-nc-accent-300">{CHAT.legible}</span>
                  <p className="mt-[6px] mb-0 text-[14.5px] text-nc-neutral-400">{CHAT.writing}</p>
                </li>
              </>
            )}
          </ol>
        )}
        <div aria-live="polite" className="sr-only">
          {announce}
        </div>

        {error && (
          <div className="mt-4" role="alert">
            <p className="m-0 max-w-[56ch] text-[15px] leading-[1.75] text-nc-neutral-200">{errorText(error.code)}</p>
            {error.code !== "too_long" && (
              <button
                type="button"
                className="btn btn-secondary mt-3 min-h-[32px]"
                onClick={() => send(error.question)}
              >
                {CHAT.tryAgain}
              </button>
            )}
          </div>
        )}

        {mode === "used" && (
          <div ref={notice} tabIndex={-1} className="mt-6 outline-none">
            <p className="m-0 max-w-[56ch] text-[15px] leading-[1.75] text-nc-neutral-200">
              {initial.paid ? CHAT.usedPaid : CHAT.usedFree}
            </p>
            {!initial.paid && offer && (
              <div className="mt-4">
                <CheckoutButton scanId={scanId} label={offer.label} />
              </div>
            )}
          </div>
        )}

        {mode === "paused" && (
          <div ref={notice} tabIndex={-1} className="mt-6 outline-none">
            <p className="m-0 max-w-[56ch] text-[15px] leading-[1.75] text-nc-neutral-200">{CHAT.paused}</p>
          </div>
        )}

        {mode === "open" && (
          <>
            {messages.length === 0 && !sending && !waiting && (
              <ul aria-label={CHAT.suggested} className="mt-4 mb-0 flex list-none flex-wrap gap-2 p-0">
                {suggestions(place).map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      className="btn btn-secondary min-h-[32px] text-[13.5px] font-normal text-nc-neutral-200"
                      onClick={() => send(s)}
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="mt-5"
              onSubmit={(e) => {
                e.preventDefault();
                void send(value);
              }}
            >
              <label htmlFor={`${id}-q`} className="mb-[6px] block text-[13px] text-nc-neutral-300">
                {CHAT.label}
              </label>
              <div className="flex flex-wrap items-stretch gap-[10px]">
                <input
                  ref={input}
                  id={`${id}-q`}
                  className="input min-h-[44px] min-w-0 flex-[1_1_14rem] text-[15px]"
                  value={value}
                  maxLength={500}
                  autoComplete="off"
                  onChange={(e) => setValue(e.target.value)}
                />
                <button type="submit" className="btn btn-primary btn-cta" disabled={!!sending}>
                  {CHAT.ask}
                </button>
              </div>
              <div className="mt-[10px] flex flex-wrap justify-between gap-x-4 gap-y-[6px] text-[13px] text-nc-neutral-400">
                <span className="tabular-nums text-nc-neutral-300">{leftText(left, initial.limit)}</span>
                <span>{privacyText(place === "report" ? "report" : "scan")}</span>
              </div>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
