import type { Metadata } from "next";
import Link from "next/link";
import { Kicker, SiteShell } from "@/components/site/SiteShell";
import { confirmSignIn } from "@/app/account/actions";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

// The link in the email lands here. Signing in takes a button press, because
// some email security tools open every link in an email to check it, and a
// sign-in that happened on page load would be used up by them.
export default async function VerifyPage(props: PageProps<"/auth/verify">) {
  const sp = await props.searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const expired = sp.expired === "1" || !token;
  return (
    <SiteShell width="narrow">
      <Kicker>Sign in</Kicker>
      {expired ? (
        <>
          <h1 className="mt-6 text-[32px] leading-[1.15] tracking-[-0.02em]">This link has expired</h1>
          <p className="mt-4 text-[15px] leading-[1.8] text-nc-neutral-300">
            Sign-in links work once and last 20 minutes. <Link href="/account">Ask for a new one</Link>.
          </p>
        </>
      ) : (
        <>
          <h1 className="mt-6 text-[32px] leading-[1.15] tracking-[-0.02em]">Continue to your reports</h1>
          <form action={confirmSignIn} className="mt-8">
            <input type="hidden" name="token" value={token} />
            <button type="submit" className="btn btn-primary btn-cta">
              Sign in
            </button>
          </form>
        </>
      )}
    </SiteShell>
  );
}
