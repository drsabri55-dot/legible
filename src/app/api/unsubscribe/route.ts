import { verifyFor } from "@/lib/crypto";
import { setMarketingEmails } from "@/lib/data";
import { json } from "@/lib/http";

// One-click unsubscribe (RFC 8058): email apps POST here from the
// List-Unsubscribe header. People clicking the link in the email get the
// /unsubscribe page instead.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const email = (url.searchParams.get("e") || "").toLowerCase();
  const sig = url.searchParams.get("s") || "";
  if (!email || !verifyFor("unsubscribe", email, sig)) return json({ error: "Invalid link" }, 400);
  await setMarketingEmails(email, false);
  return json({ ok: true });
}
