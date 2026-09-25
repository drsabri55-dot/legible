import Link from "next/link";
import { Kicker, SiteShell } from "@/components/site/SiteShell";

export default function NotFound() {
  return (
    <SiteShell width="narrow">
      <Kicker>Not found</Kicker>
      <h1 className="mt-6 text-[32px] leading-[1.15] tracking-[-0.02em]">There is nothing at this address</h1>
      <p className="mt-4 text-[15px] leading-[1.8] text-nc-neutral-300">
        The link may be mistyped or out of date. Report links stay valid, so check the address in your email.
      </p>
      <p className="mt-6">
        <Link href="/">Go to the home page</Link>
      </p>
    </SiteShell>
  );
}
