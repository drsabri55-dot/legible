import type { Metadata } from "next";
import { Kicker, SiteShell } from "@/components/site/SiteShell";
import { OwnerToWrite, Prose } from "@/components/site/Prose";

export const metadata: Metadata = { title: "Privacy" };

// The data list below describes what the code actually stores. The legal
// sections are for the owner (or their lawyer) to write.
export default function PrivacyPage() {
  return (
    <SiteShell>
      <Kicker>Privacy</Kicker>
      <h1 className="mt-6 mb-8 text-[clamp(30px,4vw,44px)] leading-[1.1] tracking-[-0.025em]">Privacy</h1>
      <Prose>
        <OwnerToWrite>who the data controller is, with contact details, and when this notice was last updated.</OwnerToWrite>

        <h2>What we store</h2>
        <ul>
          <li>The website address you scan and the results of the scan.</li>
          <li>A one-way hash of your IP address, used only to limit how many scans can be started. We do not store the address itself.</li>
          <li>Your email address, if you ask us to email a result, buy a report or sign in.</li>
          <li>Whether you want to receive offers, which you can change at any time.</li>
          <li>A record of the emails we send you.</li>
        </ul>
        <p>
          Payments are handled by Stripe. We never see or store your card details. We receive your email address, the
          amount paid and a payment reference.
        </p>
        <p>
          We use one cookie, set only when you sign in, to keep you signed in. We do not use advertising or tracking
          cookies.
        </p>

        <h2>Who processes data for us</h2>
        <ul>
          <li>Vercel (hosting)</li>
          <li>Supabase (database)</li>
          <li>Stripe (payments)</li>
          <li>Resend (email)</li>
          <li>Our scan server host (for example Railway)</li>
        </ul>

        <h2>Your rights and how long we keep data</h2>
        <OwnerToWrite>legal basis for processing, retention periods, data subject rights (access, deletion, objection) and how to exercise them, and international transfers.</OwnerToWrite>
      </Prose>
    </SiteShell>
  );
}
