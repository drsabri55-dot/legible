// Long-form text pages (terms, privacy, the scanner page).
export function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[64ch] text-[15px] leading-[1.8] text-nc-neutral-300 [&_code]:rounded [&_code]:bg-white/[0.06] [&_code]:px-1 [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-[21px] [&_h2]:leading-[1.25] [&_h2]:tracking-[-0.015em] [&_h2]:text-nc-neutral-100 [&_li]:mb-2 [&_p]:mb-4 [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-[8px] [&_pre]:border [&_pre]:border-white/10 [&_pre]:bg-[#0e0f18] [&_pre]:p-4 [&_pre]:text-[13px] [&_pre]:text-nc-neutral-200 [&_ul]:mb-4 [&_ul]:pl-5">
      {children}
    </div>
  );
}

// A clearly marked gap for text only the owner can supply (legal wording,
// company details). Visible on purpose, so it cannot go live unnoticed.
export function OwnerToWrite({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[8px] border border-dashed border-nc-serious/60 bg-nc-serious/[0.06] px-4 py-3 text-[14px] text-nc-serious">
      To be written by the owner: {children}
    </p>
  );
}
