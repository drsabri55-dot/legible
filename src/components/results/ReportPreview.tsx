import Image from "next/image";

// Two pages of a sample report, as they print in the PDF: the cover, and the
// first must-fix page behind it. The site is made up, so no real business
// appears. Remake the pictures with `npm run report-preview`.
export function ReportPreview() {
  return (
    <figure className="m-0 w-[212px] shrink-0">
      <div className="relative h-[236px]">
        <Image
          src="/report-preview/issue.jpg"
          alt="Sample issue page: form fields have no label, with what is wrong, who it affects and the corrected code."
          width={794}
          height={1123}
          sizes="150px"
          className="absolute top-[24px] left-[62px] h-auto w-[150px] rounded-[3px] shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
        />
        <Image
          src="/report-preview/cover.jpg"
          alt="Sample report cover for yourbusiness.com, with its score and the number of failures."
          width={794}
          height={1123}
          sizes="150px"
          className="absolute top-0 left-0 h-auto w-[150px] rounded-[3px] border border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
        />
      </div>
      <figcaption className="mt-3 text-[12px] leading-[1.6] text-nc-neutral-400">
        Two pages from a sample report for yourbusiness.com, a made-up site.
      </figcaption>
    </figure>
  );
}
