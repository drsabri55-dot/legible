import type { Metadata } from "next";
import { Kicker, SiteShell } from "@/components/site/SiteShell";
import { Prose } from "@/components/site/Prose";
import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: "About our scanner",
  description: "LegibleBot checks websites for accessibility issues when someone asks for a scan. How it behaves and how to stop it.",
};

export default function BotPage() {
  const contact = env.contactEmail();
  return (
    <SiteShell>
      <Kicker>LegibleBot</Kicker>
      <h1 className="mt-6 mb-8 text-[clamp(30px,4vw,44px)] leading-[1.1] tracking-[-0.025em]">About our scanner</h1>
      <Prose>
        <p>
          LegibleBot is the scanner behind Legible. It visits a website only when someone enters that site&rsquo;s
          address on Legible&rsquo;s home page and asks for a free accessibility scan.
        </p>
        <h2>What it does</h2>
        <ul>
          <li>It loads the home page and up to five pages linked from the site&rsquo;s navigation, one at a time, with a pause between pages.</li>
          <li>It reads each page and checks it against WCAG 2.1 Level AA. It does not fill in forms, log in, buy anything or change anything.</li>
          <li>It follows robots.txt and identifies itself in its user agent as <code>LegibleBot/1.0</code>.</li>
          <li>It limits how often the same site can be scanned.</li>
        </ul>
        <h2>How to stop it</h2>
        <p>Add these lines to your site&rsquo;s robots.txt and LegibleBot will not scan it:</p>
        <pre>
          <code>{"User-agent: LegibleBot\nDisallow: /"}</code>
        </pre>
        {contact ? (
          <p>
            Or email <a href={`mailto:${contact}`}>{contact}</a> with your site&rsquo;s address and we will add it to
            our block list, usually within one working day.
          </p>
        ) : (
          <p>Or contact us and we will add your site to our block list.</p>
        )}
      </Prose>
    </SiteShell>
  );
}
