"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto max-w-[34rem] px-6 py-24">
      <p className="kicker">Something went wrong</p>
      <h1 className="mt-6 text-[32px] leading-[1.15] tracking-[-0.02em]">This page could not load</h1>
      <p className="mt-4 text-[15px] leading-[1.8] text-nc-neutral-300">
        It is our fault, not yours. Try again, and if it keeps happening, come back in a few minutes.
      </p>
      <div className="mt-8 flex gap-6">
        <button type="button" className="btn btn-primary btn-cta" onClick={() => reset()}>
          Try again
        </button>
        <Link href="/" className="self-center">
          Home
        </Link>
      </div>
    </main>
  );
}
