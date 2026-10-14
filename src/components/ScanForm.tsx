"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { normaliseSite, siteName } from "@/lib/url";

type State = { kind: "idle" } | { kind: "error"; message: string } | { kind: "sending"; host: string };

// The one input on the site: a website address. Checks it in the browser for
// quick feedback, then asks the server to start the scan and goes to the
// result page, or to the AI agent's chat.
export function ScanForm({
  variant = "landing",
  goTo = "result",
  submitLabel = "Scan a site",
}: {
  variant?: "landing" | "compact";
  goTo?: "result" | "agent";
  submitLabel?: string;
}) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const errorId = `${id}-error`;
  const statusId = `${id}-status`;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === "sending") return;
    const site = normaliseSite(value, { allowPrivate: process.env.NEXT_PUBLIC_ALLOW_PRIVATE_TARGETS === "1" });
    if (!site.ok) {
      setState({ kind: "error", message: site.error });
      return;
    }
    setState({ kind: "sending", host: siteName(site.host) });
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: value }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setState({ kind: "error", message: data.error || "Something went wrong. Try again in a moment." });
        return;
      }
      router.push(goTo === "agent" ? `/agent/${data.id}` : `/scan/${data.id}`);
    } catch {
      setState({ kind: "error", message: "We could not reach Legible. Check your connection and try again." });
    }
  }

  const sending = state.kind === "sending";
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-[10px]">
      <label
        htmlFor={id}
        className={
          variant === "landing"
            ? "text-[12px] uppercase tracking-[0.2em] text-nc-neutral-100"
            : "text-[12px] text-nc-neutral-300"
        }
      >
        Website address
      </label>
      <div className="flex flex-wrap items-stretch gap-[10px]">
        <input
          id={id}
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="yourbusiness.com"
          className="input input-strong min-w-0 flex-[1_1_14rem]"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (state.kind === "error") setState({ kind: "idle" });
          }}
          aria-invalid={state.kind === "error"}
          aria-describedby={state.kind === "error" ? errorId : sending ? statusId : undefined}
        />
        <button type="submit" className="btn btn-primary btn-cta" disabled={sending}>
          {submitLabel}
        </button>
      </div>
      <div aria-live="polite" className="min-h-[1.7em] text-[13px] leading-[1.7]">
        {state.kind === "error" && (
          <span id={errorId} className="text-nc-critical">
            {state.message}
          </span>
        )}
        {sending && (
          <span id={statusId} className="text-nc-neutral-300">
            Scanning <span className="text-nc-accent-300">{state.host}</span> (up to six pages)…
          </span>
        )}
      </div>
    </form>
  );
}
