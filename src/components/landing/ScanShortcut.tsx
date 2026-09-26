"use client";

// "Scan your site" in the landing header: jumps past the story to the form in
// chapter 07 and puts the cursor in the address field. Without scripts it is
// a plain link to the same place.
export function ScanShortcut({ className }: { className?: string }) {
  return (
    <a
      href="#scan"
      className={className}
      onClick={(e) => {
        const target = document.getElementById("scan");
        const field = target?.querySelector<HTMLInputElement>("input[name='url']");
        if (!target || !field) return;
        e.preventDefault();
        const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
        // Halfway into the chapter: its headline has inked in by then and the
        // form sits pinned in view.
        const top = target.getBoundingClientRect().top + window.scrollY;
        const y = top + Math.max(0, (target.offsetHeight - window.innerHeight) * 0.5);
        window.scrollTo({ top: y, behavior: reduce ? "auto" : "smooth" });
        field.focus({ preventScroll: true });
        history.replaceState(null, "", "#scan");
      }}
    >
      Scan your site
    </a>
  );
}
