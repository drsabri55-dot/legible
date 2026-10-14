import type { Metadata } from "next";
import { ScanForm } from "@/components/ScanForm";
import { AGENT } from "@/components/agent/wording";
import { Kicker, SiteShell } from "@/components/site/SiteShell";
import { chatEnabled } from "@/lib/chat/limits";

export const metadata: Metadata = { title: "Ask our AI agent" };

// The AI agent page, from the button at the end of the landing page: type a
// website address and go straight to the chat, while the free scan runs.
// Without the agent it is the plain scan form.
export default function AgentPage() {
  const on = chatEnabled();
  return (
    <SiteShell>
      <Kicker>{AGENT.kicker}</Kicker>
      <h1 className="mt-6 mb-0 text-[clamp(30px,4vw,48px)] leading-[1.1] tracking-[-0.025em]">{AGENT.heading}</h1>
      <p className="mt-4 mb-0 max-w-[56ch] text-[15px] leading-[1.8] text-nc-neutral-300">
        {on ? AGENT.intro : AGENT.intro.slice(0, AGENT.intro.lastIndexOf(" You can ask"))}
      </p>
      <div className="mt-8 max-w-[34rem]">
        {on ? <ScanForm variant="compact" goTo="agent" submitLabel={AGENT.start} /> : <ScanForm variant="compact" />}
      </div>
    </SiteShell>
  );
}
