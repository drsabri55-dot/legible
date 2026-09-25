"use server";

import { redirect } from "next/navigation";
import { EMAIL_PATTERN, redeemSignInLink, sendSignInLink } from "@/lib/auth/login";
import { setMarketingEmails, upsertUser } from "@/lib/data";
import { endSession, getSessionEmail, startSession } from "@/lib/session";

export type SignInState = { status: "idle" | "sent" | "error"; message?: string; email?: string };

export async function requestSignIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") || "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return { status: "error", message: "Enter an email address, like you@yourbusiness.com.", email };
  }
  try {
    await sendSignInLink(email);
  } catch (e) {
    console.error("[sign-in]", e);
    return { status: "error", message: "We could not send the email. Try again in a few minutes.", email };
  }
  return { status: "sent", email };
}

export async function confirmSignIn(form: FormData): Promise<void> {
  const email = await redeemSignInLink(String(form.get("token") || ""));
  if (!email) redirect("/auth/verify?expired=1");
  await upsertUser(email);
  await startSession(email);
  redirect("/account");
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect("/account");
}

export async function savePreferences(form: FormData): Promise<void> {
  const email = await getSessionEmail();
  if (!email) redirect("/account");
  await setMarketingEmails(email, form.get("marketing") === "on");
  redirect("/account?saved=1");
}
