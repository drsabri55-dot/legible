import "server-only";
import { randomToken, sha256 } from "../crypto";
import { consumeLoginToken, countRecentLoginTokens, getUserByEmail, saveLoginToken } from "../data";
import { sendEmail } from "../email/send";
import { env } from "../env";

export const LINK_MINUTES = 20;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Emails a single-use sign-in link, but only to customers (and the owner), so
// the form cannot be used to send our email to strangers. The page says the
// same thing either way, so it cannot be used to find out who is a customer.
export async function sendSignInLink(email: string): Promise<void> {
  const address = email.trim().toLowerCase();
  const known = env.adminEmails().includes(address) || !!(await getUserByEmail(address));
  if (!known) return;
  if ((await countRecentLoginTokens(address, 60)) >= 5) return;
  const token = randomToken(32);
  await saveLoginToken(address, sha256(token), LINK_MINUTES);
  await sendEmail({
    to: address,
    template: "sign-in",
    vars: { link: `${env.appUrl()}/auth/verify?token=${token}`, email: address },
  });
}

export async function redeemSignInLink(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) return null;
  return consumeLoginToken(sha256(token));
}
