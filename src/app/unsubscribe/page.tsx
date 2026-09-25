import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Kicker, SiteShell } from "@/components/site/SiteShell";
import { verifyFor } from "@/lib/crypto";
import { setMarketingEmails } from "@/lib/data";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

async function unsubscribe(form: FormData) {
  "use server";
  const email = String(form.get("e") || "").toLowerCase();
  const sig = String(form.get("s") || "");
  if (!verifyFor("unsubscribe", email, sig)) redirect("/unsubscribe");
  await setMarketingEmails(email, false);
  redirect(`/unsubscribe?e=${encodeURIComponent(email)}&s=${sig}&done=1`);
}

// A button, not an automatic unsubscribe on page load: email security tools
// open links to check them, and that must not unsubscribe anyone.
export default async function UnsubscribePage(props: PageProps<"/unsubscribe">) {
  const sp = await props.searchParams;
  const email = typeof sp.e === "string" ? sp.e.toLowerCase() : "";
  const sig = typeof sp.s === "string" ? sp.s : "";
  const valid = !!email && verifyFor("unsubscribe", email, sig);

  return (
    <SiteShell width="narrow">
      <Kicker>Email preferences</Kicker>
      {!valid ? (
        <>
          <h1 className="mt-6 text-[32px] leading-[1.15] tracking-[-0.02em]">This link is not valid</h1>
          <p className="mt-4 text-[15px] leading-[1.8] text-nc-neutral-300">
            Use the unsubscribe link in the most recent email from Legible, or sign in to your account to change your
            preferences.
          </p>
        </>
      ) : sp.done === "1" ? (
        <>
          <h1 className="mt-6 text-[32px] leading-[1.15] tracking-[-0.02em]">You are unsubscribed</h1>
          <p className="mt-4 text-[15px] leading-[1.8] text-nc-neutral-300">
            {email} will not get offers from Legible. Report emails and sign-in links you ask for will still arrive.
          </p>
        </>
      ) : (
        <>
          <h1 className="mt-6 text-[32px] leading-[1.15] tracking-[-0.02em]">Unsubscribe from offers?</h1>
          <p className="mt-4 text-[15px] leading-[1.8] text-nc-neutral-300">
            {email} will stop getting offers such as monthly monitoring.
          </p>
          <form action={unsubscribe} className="mt-8">
            <input type="hidden" name="e" value={email} />
            <input type="hidden" name="s" value={sig} />
            <button type="submit" className="btn btn-primary btn-cta">
              Unsubscribe
            </button>
          </form>
        </>
      )}
    </SiteShell>
  );
}
