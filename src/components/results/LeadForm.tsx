"use client";

import { useId, useState } from "react";

export function LeadForm({ scanId, alreadySent }: { scanId: string; alreadySent: boolean }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(alreadySent ? "sent" : "idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const res = await fetch(`/api/scans/${scanId}/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    if (res?.ok) {
      setState("sent");
      return;
    }
    const data = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setMessage(data?.error || "That did not work. Try again in a moment.");
    setState("error");
  }

  if (state === "sent") {
    return (
      <p className="m-0 text-[14px] text-nc-neutral-300" role="status">
        Sent. Check your inbox for a copy of this result.
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2" noValidate>
      <label htmlFor={id} className="text-[12px] text-nc-neutral-300">
        Email me this result
      </label>
      <div className="flex flex-wrap gap-[10px]">
        <input
          id={id}
          type="email"
          autoComplete="email"
          required
          placeholder="you@yourbusiness.com"
          className="input min-w-0 flex-[1_1_14rem]"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={state === "error"}
          aria-describedby={state === "error" ? `${id}-err` : undefined}
        />
        <button type="submit" className="btn btn-secondary px-4" disabled={state === "sending"}>
          Send
        </button>
      </div>
      <div aria-live="polite" className="text-[13px] text-nc-critical">
        {state === "error" && <span id={`${id}-err`}>{message}</span>}
      </div>
    </form>
  );
}
