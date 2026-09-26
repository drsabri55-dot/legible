import type { Metadata } from "next";
import Link from "next/link";
import { Kicker, SiteShell } from "@/components/site/SiteShell";
import { getUserByEmail, listReportsForEmail } from "@/lib/data";
import { env } from "@/lib/env";
import { getSessionEmail } from "@/lib/session";
import { siteName } from "@/lib/url";
import { savePreferences, signOut } from "./actions";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Your reports", robots: { index: false, follow: false } };

function date(d: Date | null): string {
  return d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
}

export default async function AccountPage(props: PageProps<"/account">) {
  const email = await getSessionEmail();
  const sp = await props.searchParams;

  if (!email) {
    return (
      <SiteShell width="narrow">
        <Kicker>Your reports</Kicker>
        <h1 className="mt-6 mb-0 text-[clamp(30px,4vw,44px)] leading-[1.1] tracking-[-0.025em]">Sign in</h1>
        <p className="mt-4 mb-8 text-[15px] leading-[1.8] text-nc-neutral-300">
          No password needed. Enter the email address you used to buy a report and we will send you a link.
        </p>
        <SignInForm />
      </SiteShell>
    );
  }

  const [reports, user] = await Promise.all([listReportsForEmail(email), getUserByEmail(email)]);
  const isAdmin = env.adminEmails().includes(email);

  return (
    <SiteShell>
      <Kicker>Your reports</Kicker>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <h1 className="m-0 text-[clamp(30px,4vw,44px)] leading-[1.1] tracking-[-0.025em]">Reports</h1>
        <p className="m-0 text-[13px] text-nc-neutral-400">Signed in as {email}</p>
      </div>

      {reports.length === 0 ? (
        <div className="mt-8 max-w-[48ch]">
          <p className="text-[15px] leading-[1.8] text-nc-neutral-300">
            There are no reports for this address yet. Reports appear here after you buy one from a free scan result.
          </p>
          <p className="mt-4">
            <Link href="/" className="inline-flex min-h-6 items-center">
              Start a free scan
            </Link>
          </p>
        </div>
      ) : (
        <ul className="mt-8 list-none divide-y divide-white/[0.08] border-y border-white/[0.08] p-0">
          {reports.map((r) => (
            <li key={r.token} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-5">
              <div className="min-w-0">
                <p className="m-0 text-[17px] break-words text-nc-neutral-100">{siteName(r.host)}</p>
                <p className="mt-1 mb-0 text-[13px] text-nc-neutral-400">
                  Score {r.score ?? "–"} · scanned {date(r.scanned_at)} · bought {date(r.created_at)}
                </p>
              </div>
              <div className="flex gap-5 text-[14px]">
                <Link href={`/report/${r.token}`} className="inline-flex min-h-6 items-center">
                  Open report<span className="sr-only"> for {siteName(r.host)}</span>
                </Link>
                <a href={`/report/${r.token}/pdf`} className="inline-flex min-h-6 items-center">
                  PDF<span className="sr-only"> for {siteName(r.host)}</span>
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="prefs" className="mt-14 max-w-[40rem]">
        <h2 id="prefs" className="m-0 text-[20px] tracking-[-0.015em]">
          Email preferences
        </h2>
        <form action={savePreferences} className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex min-h-6 items-center gap-3 text-[14.5px] text-nc-neutral-200">
            <input
              type="checkbox"
              name="marketing"
              defaultChecked={user?.marketing_emails ?? true}
              className="h-[18px] w-[18px] accent-[var(--color-accent-500)]"
            />
            Send me occasional offers, such as monthly monitoring
          </label>
          <button type="submit" className="btn btn-secondary px-4">
            Save
          </button>
          {sp.saved === "1" && (
            <span role="status" className="text-[13px] text-nc-neutral-300">
              Saved.
            </span>
          )}
        </form>
        <p className="mt-3 text-[13px] text-nc-neutral-500">Report emails and sign-in links are always sent.</p>
      </section>

      <div className="mt-12 flex flex-wrap items-center gap-6">
        <form action={signOut}>
          <button type="submit" className="btn btn-secondary px-4">
            Sign out
          </button>
        </form>
        {isAdmin && (
          <Link href="/admin" className="inline-flex min-h-6 items-center">
            Owner dashboard
          </Link>
        )}
      </div>
    </SiteShell>
  );
}
