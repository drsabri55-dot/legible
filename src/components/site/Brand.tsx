import Link from "next/link";
import { Logo } from "./Logo";

export function Brand() {
  return (
    <Link
      href="/"
      className="flex min-h-6 items-center font-medium tracking-[-0.01em] text-nc-text no-underline hover:text-nc-text"
      aria-label="Legible, home"
    >
      <Logo />
    </Link>
  );
}
