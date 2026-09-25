import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-[10px] text-nc-text no-underline hover:text-nc-text" aria-label="Legible, home">
      <span
        aria-hidden="true"
        className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[6px] border border-nc-accent-600"
      >
        <span className="block h-[6px] w-[6px] rounded-full bg-nc-accent-400" />
      </span>
      <span className="text-[14px] font-medium tracking-[-0.01em]">Legible</span>
    </Link>
  );
}
