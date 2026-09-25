"use client";

import { useState } from "react";

export function CheckoutButton({ scanId, label }: { scanId: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scanId }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error || "Checkout could not start. Try again in a moment.");
        setBusy(false);
        return;
      }
      window.location.assign(data.url);
    } catch {
      setError("We could not reach Legible. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" onClick={go} disabled={busy} className="btn btn-primary btn-cta">
        {busy ? "Opening secure checkout…" : label}
      </button>
      <div aria-live="polite" className="text-[13px] text-nc-critical">
        {error}
      </div>
    </div>
  );
}
