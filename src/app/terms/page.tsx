import type { Metadata } from "next";
import { Kicker, SiteShell } from "@/components/site/SiteShell";
import { OwnerToWrite, Prose } from "@/components/site/Prose";

export const metadata: Metadata = { title: "Terms" };

// The owner supplies the legal wording. Only the disclaimer is fixed here,
// because the product brief requires it in the terms from day one.
export default function TermsPage() {
  return (
    <SiteShell>
      <Kicker>Terms</Kicker>
      <h1 className="mt-6 mb-8 text-[clamp(30px,4vw,44px)] leading-[1.1] tracking-[-0.025em]">Terms of service</h1>
      <Prose>
        <OwnerToWrite>who provides the service (business name, address, registration), and when these terms were last updated.</OwnerToWrite>

        <h2>What Legible reports</h2>
        <p>
          Legible identifies issues measured against WCAG 2.1 Level AA using automated testing. Automated testing cannot
          detect every issue, so manual review is recommended. A Legible score or report is not legal advice or a
          certification, and it does not state or imply that a website complies with any law or standard, including the
          European Accessibility Act, EN 301 549 or the Americans with Disabilities Act.
        </p>

        <h2>Scope of a report</h2>
        <p>
          A report covers the home page and up to five pages linked from its navigation, as they were at the time of
          the scan. Pages that could not be loaded, or that the site&rsquo;s robots.txt excludes, are not covered.
        </p>

        <h2>Payment and refunds</h2>
        <OwnerToWrite>price, currency, taxes, delivery (the report is delivered by email and link straight after payment) and the refund policy.</OwnerToWrite>

        <h2>Acceptable use</h2>
        <OwnerToWrite>rules for scanning, for example only scanning sites you own or are authorised to test, and our right to refuse or stop scans.</OwnerToWrite>

        <h2>Liability</h2>
        <OwnerToWrite>limitation of liability and governing law. Have a lawyer review this section.</OwnerToWrite>
      </Prose>
    </SiteShell>
  );
}
