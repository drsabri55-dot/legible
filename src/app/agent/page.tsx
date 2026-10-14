import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ScanForm } from "@/components/ScanForm";
import { AGENT } from "@/components/agent/wording";
import { Kicker, SiteShell } from "@/components/site/SiteShell";
import { agentPageOpen } from "@/lib/chat/limits";

export const metadata: Metadata = { title: "Ask our AI agent" };

// The AI agent page, from the button at the end of the landing page: type a
// website address and go straight to the chat, while the free scan runs.
// When the agent cannot run (no key or prices, or today's limit reached), it
// sends people to the landing page's scan form instead of promising a chat.
export default async function AgentPage() {
  await connection();
  if (!(await agentPageOpen())) redirect("/#scan");
  return (
    <SiteShell>
      <Kicker>{AGENT.kicker}</Kicker>
      <h1 className="mt-6 mb-0 text-[clamp(30px,4vw,48px)] leading-[1.1] tracking-[-0.025em]">{AGENT.heading}</h1>
      <p className="mt-4 mb-0 max-w-[56ch] text-[15px] leading-[1.8] text-nc-neutral-300">{AGENT.intro}</p>
      <div className="mt-8 max-w-[34rem]">
        <ScanForm variant="compact" goTo="agent" submitLabel={AGENT.start} />
      </div>
    </SiteShell>
  );
}
