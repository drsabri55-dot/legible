import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import { logEmail } from "../data";
import { env } from "../env";
import { renderEmail, type TemplateName } from "./render";

export interface Attachment {
  filename: string;
  content: Buffer;
}

export interface SendInput {
  to: string;
  template: TemplateName;
  vars: Record<string, string | number>;
  attachments?: Attachment[];
  // Marketing emails carry one-click unsubscribe headers.
  unsubscribeUrl?: string;
}

// Sends through Resend when RESEND_API_KEY is set. Without it (local
// development), the email is written to .data/outbox so you can open it.
export async function sendEmail(input: SendInput): Promise<string | null> {
  const email = await renderEmail(input.template, input.vars);
  const headers: Record<string, string> = {};
  if (input.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${input.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const key = env.resendApiKey();
  if (!key) {
    if (env.isVercelProduction()) throw new Error("RESEND_API_KEY is not set, so email cannot be sent.");
    const dir = path.join(process.cwd(), ".data", "outbox");
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `${stamp}-${input.template}.html`);
    const banner = `<!-- To: ${input.to} | Subject: ${email.subject} | Attachments: ${(input.attachments || []).map((a) => a.filename).join(", ") || "none"} -->\n`;
    await writeFile(file, banner + email.html);
    for (const a of input.attachments || []) await writeFile(path.join(dir, `${stamp}-${a.filename}`), a.content);
    console.log(`[email] ${input.template} to ${input.to}: "${email.subject}" (saved to ${path.relative(process.cwd(), file)})`);
    await logEmail(input.to, input.template, null);
    return null;
  }

  const resend = new Resend(key);
  const { data, error } = await resend.emails.send({
    from: env.emailFrom(),
    to: input.to,
    replyTo: env.emailReplyTo(),
    subject: email.subject,
    html: email.html,
    text: email.text,
    headers,
    attachments: input.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
  });
  if (error) throw new Error(`Resend refused the email: ${error.message}`);
  await logEmail(input.to, input.template, data?.id ?? null);
  return data?.id ?? null;
}

// Best effort: an alert that fails to send must never break the request that
// triggered it.
export async function alertOwner(subject: string, message: string, link = env.appUrl()): Promise<void> {
  const to = env.ownerEmail();
  if (!to) {
    console.warn(`[alert] ${subject}: ${message}`);
    return;
  }
  try {
    await sendEmail({ to, template: "owner-alert", vars: { subject, message, link } });
  } catch (e) {
    console.error("[alert] could not email the owner", e);
  }
}
