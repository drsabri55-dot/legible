import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AGENT } from "@/components/agent/wording";
import { Chat } from "@/components/chat/Chat";
import { ScanProgress } from "@/components/results/ScanProgress";
import { Kicker, SiteShell } from "@/components/site/SiteShell";
import { chatState } from "@/lib/chat/ask";
import { chatEnabled } from "@/lib/chat/limits";
import { getScan } from "@/lib/data";
import { privatePage } from "@/lib/page-meta";
import { siteName } from "@/lib/url";

export async function generateMetadata(props: PageProps<"/agent/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const scan = await getScan(id);
  return privatePage(scan ? `Ask about ${siteName(scan.host)}` : null);
}

// The chat first, with the scan's progress above it. Answers use what the
// agent has tested so far. Without the chat, this is the scan's own page.
export default async function AgentChatPage(props: PageProps<"/agent/[id]">) {
  const { id } = await props.params;
  const scan = await getScan(id);
  if (!scan) notFound();
  if (!chatEnabled() || scan.status === "failed") redirect(`/scan/${id}`);
  const running = scan.status === "queued" || scan.status === "running";
  return (
    <SiteShell>
      <Kicker>{AGENT.kicker}</Kicker>
      <h1 className="mt-6 mb-0 text-[clamp(30px,4vw,48px)] leading-[1.1] tracking-[-0.025em] break-words">
        {siteName(scan.host)}
      </h1>
      <div className="mt-6">
        {running ? (
          <>
            <ScanProgress
              scanId={scan.id}
              host={siteName(scan.host)}
              agent={scan.agent === "on"}
              compact
              initial={{ status: scan.status, pagesDone: scan.pages_done, pagesTotal: scan.pages_total, error: null }}
            />
            <p className="mt-3 mb-0 text-[14px]">
              <Link href={`/scan/${scan.id}`}>{AGENT.watch}</Link>
            </p>
          </>
        ) : (
          <p className="m-0 text-[15px] text-nc-neutral-300">
            {AGENT.resultReady} <Link href={`/scan/${scan.id}`}>{AGENT.seeResult}</Link>
          </p>
        )}
      </div>
      <Chat scanId={scan.id} place="agent" anchors={[]} offer={null} initial={await chatState(scan)} />
    </SiteShell>
  );
}
