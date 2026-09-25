import Link from "next/link";
import { Brand } from "./Brand";

export const DISCLAIMER =
  "Legible identifies issues measured against WCAG 2.1 Level AA. Automated testing cannot detect every issue, so manual review is recommended.";

// Frame for every page except the landing story: header, main, footer, on the
// Nocturne ground.
export function SiteShell({ children, width = "normal" }: { children: React.ReactNode; width?: "normal" | "wide" | "narrow" }) {
  const max = width === "wide" ? "max-w-[64rem]" : width === "narrow" ? "max-w-[34rem]" : "max-w-[52rem]";
  return (
    <div className="relative min-h-screen overflow-x-clip bg-nc-bg">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(70% 50% at 78% 0%, oklch(0.7 0.07 266 / 0.08) 0%, transparent 70%), linear-gradient(176deg, oklch(0.128 0.022 266) 0%, oklch(0.1 0.016 264) 46%, oklch(0.074 0.01 262) 100%)",
        }}
      />
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <div className="relative flex min-h-screen flex-col px-[clamp(20px,6vw,96px)]">
        <header className="flex h-16 items-center justify-between gap-4">
          <Brand />
          <nav aria-label="Account">
            <Link href="/account" className="inline-block py-1 text-[13px] text-nc-neutral-300 no-underline hover:text-nc-accent-200">
              Your reports
            </Link>
          </nav>
        </header>
        <main id="main" className={`mx-auto w-full ${max} flex-1 pt-10 pb-20`}>
          {children}
        </main>
        <footer className="-mx-[clamp(20px,6vw,96px)] border-t border-white/[0.08] bg-[#0b0c14] px-[clamp(20px,6vw,96px)] py-10 text-[12px] leading-[1.7] text-nc-neutral-500">
          <p className="m-0 text-[11px] uppercase tracking-[0.18em] text-nc-neutral-400">
            An independent audit. No overlay widgets.
          </p>
          <p className="mt-3 max-w-[62ch]">{DISCLAIMER}</p>
          <ul className="mt-2 flex list-none flex-wrap gap-x-[18px] p-0 text-[11px] uppercase tracking-[0.16em]">
            {[
              ["/", "Home"],
              ["/terms", "Terms"],
              ["/privacy", "Privacy"],
              ["/account", "Your reports"],
              ["/bot", "About our scanner"],
            ].map(([href, label]) => (
              <li key={href}>
                <Link href={href} className="inline-block py-[5px] text-nc-neutral-400 no-underline hover:text-nc-accent-200 hover:underline">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </footer>
      </div>
    </div>
  );
}

export function Kicker({ children }: { children: React.ReactNode }) {
  return <span className="kicker">{children}</span>;
}
