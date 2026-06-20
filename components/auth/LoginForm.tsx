"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "@/app/auth/actions";

const initialState: SignInState = { error: null };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <div className="w-full max-w-[380px]">
      <div className="font-mono text-xs uppercase tracking-[0.14em] text-muted">
        Client workspace
      </div>
      <h1 className="mb-1.5 mt-2.5 text-[30px] font-bold tracking-[-0.02em]">
        Welcome back
      </h1>
      <div className="mb-7 text-[15px] text-muted">
        Sign in to see what Emma did while you were busy.
      </div>

      {state.error ? (
        <div className="mb-[18px] flex items-start gap-2.5 rounded-[12px] border border-danger/30 bg-danger/[0.08] px-3.5 py-3">
          <div className="mt-px flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-danger font-mono text-xs text-white">
            !
          </div>
          <div>
            <div className="text-[13.5px] font-medium text-[#B8323A]">
              That didn’t match.
            </div>
            <div className="mt-0.5 text-[13px] text-muted">{state.error}</div>
          </div>
        </div>
      ) : null}

      <form action={formAction}>
        <label
          htmlFor="email"
          className="mb-[7px] block font-mono text-[11px] uppercase tracking-[0.1em] text-muted"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mb-4 h-[46px] w-full rounded-[12px] border border-ink/10 bg-white px-3.5 font-display text-[15px] text-ink outline-none focus:border-violet focus:shadow-[0_0_0_3px_rgba(109,74,255,0.14)]"
        />

        <label
          htmlFor="password"
          className="mb-[7px] block font-mono text-[11px] uppercase tracking-[0.1em] text-muted"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mb-2.5 h-[46px] w-full rounded-[12px] border border-ink/10 bg-white px-3.5 font-display text-[15px] text-ink outline-none focus:border-violet focus:shadow-[0_0_0_3px_rgba(109,74,255,0.14)]"
        />

        <div className="mb-5 flex justify-end">
          <a className="cursor-pointer text-[13px] font-medium text-violet no-underline">
            Forgot password?
          </a>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="flex h-12 w-full items-center justify-center gap-2.5 rounded-[12px] bg-violet text-[15px] font-medium text-white shadow-[0_6px_18px_rgba(109,74,255,0.32)] transition hover:bg-[#5d3df0] disabled:opacity-80"
        >
          {pending ? (
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            <span>{state.error ? "Try again" : "Sign in to Emma"}</span>
          )}
        </button>
      </form>

      <div className="mt-[30px] text-center text-[12.5px] text-muted">
        Secured by Supabase · One workspace, your data only
      </div>
    </div>
  );
}
