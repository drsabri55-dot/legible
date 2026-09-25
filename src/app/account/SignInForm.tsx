"use client";

import { useActionState, useId } from "react";
import { requestSignIn, type SignInState } from "./actions";

export function SignInForm() {
  const id = useId();
  const [state, action, pending] = useActionState<SignInState, FormData>(requestSignIn, { status: "idle" });

  if (state.status === "sent") {
    return (
      <div role="status" className="rounded-[14px] border border-nc-accent-700 bg-nc-accent-900/40 p-6">
        <p className="m-0 text-[17px] text-nc-neutral-100">Check your email</p>
        <p className="mt-2 mb-0 text-[14.5px] leading-[1.8] text-nc-neutral-300">
          If {state.email} has reports with us, a sign-in link is on its way. It works once and expires in 20 minutes.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-[10px]" noValidate>
      <label htmlFor={id} className="text-[12px] text-nc-neutral-300">
        Email address used at checkout
      </label>
      <div className="flex flex-wrap gap-[10px]">
        <input
          id={id}
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          placeholder="you@yourbusiness.com"
          className="input input-strong min-w-0 flex-[1_1_14rem]"
          aria-invalid={state.status === "error"}
          aria-describedby={state.status === "error" ? `${id}-err` : undefined}
        />
        <button type="submit" className="btn btn-primary btn-cta" disabled={pending}>
          {pending ? "Sending…" : "Email me a sign-in link"}
        </button>
      </div>
      <div aria-live="polite" className="min-h-[1.6em] text-[13px] text-nc-critical">
        {state.status === "error" && <span id={`${id}-err`}>{state.message}</span>}
      </div>
    </form>
  );
}
