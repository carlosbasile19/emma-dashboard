"use client";

import { useState, useTransition, type FormEvent } from "react";
import { passwordSignIn, sendMagicLink } from "@/app/auth/actions";

const INPUT =
  "h-[46px] w-full rounded-[12px] border border-ink/10 bg-white px-3.5 font-display text-[15px] text-ink outline-none focus:border-violet focus:shadow-[0_0_0_3px_rgba(109,74,255,0.14)]";
const LABEL =
  "mb-[7px] block font-mono text-[11px] uppercase tracking-[0.1em] text-muted";

export function LoginForm({ initialError }: { initialError?: string | null }) {
  const [mode, setMode] = useState<"magic" | "password">("magic");
  const [view, setView] = useState<"form" | "sent">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [noAccount, setNoAccount] = useState(false);
  const [pending, startTransition] = useTransition();

  function sendLink(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNoAccount(false);
    startTransition(async () => {
      const res = await sendMagicLink(email);
      if (res.error) {
        setError(res.error);
        setNoAccount(res.code === "no_account");
      } else setView("sent");
    });
  }

  function signInPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNoAccount(false);
    startTransition(async () => {
      // On success the action redirects to /dashboard (carrying the new session cookie).
      const res = await passwordSignIn(email, password);
      if (res?.error) setError(res.error);
    });
  }

  function switchMode(next: "magic" | "password") {
    setMode(next);
    setView("form");
    setError(null);
    setNoAccount(false);
  }

  const ErrorBox = error ? (
    <div className="mb-[18px] flex items-start gap-2.5 rounded-[12px] border border-danger/30 bg-danger/[0.08] px-3.5 py-3">
      <div className="mt-px flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-danger font-mono text-xs text-white">
        !
      </div>
      <div>
        <div className="text-[13.5px] font-medium text-[#B8323A]">
          {noAccount ? "Account not found." : "We couldn’t sign you in."}
        </div>
        <div className="mt-0.5 text-[13px] text-muted">{error}</div>
      </div>
    </div>
  ) : null;

  return (
    <div className="w-full max-w-[380px]">
      <div className="font-mono text-xs uppercase tracking-[0.14em] text-muted">
        Client workspace
      </div>
      <h1 className="mb-1.5 mt-2.5 text-[30px] font-bold tracking-[-0.02em]">Welcome back</h1>
      <div className="mb-7 text-[15px] leading-[1.5] text-muted">
        {mode === "magic"
          ? "No passwords here. Enter your email and we’ll send a one-click magic link to sign you in."
          : "Enter your email and password to sign in to your workspace."}
      </div>

      {mode === "password" ? (
        <>
          <form onSubmit={signInPassword}>
            {ErrorBox}
            <label htmlFor="email" className={LABEL}>Email</label>
            <input id="email" name="email" type="email" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} className={`${INPUT} mb-4`} />
            <label htmlFor="password" className={LABEL}>Password</label>
            <input id="password" name="password" type="password" required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} className={`${INPUT} mb-[18px]`} />
            <button type="submit" disabled={pending}
              className="flex h-12 w-full items-center justify-center gap-2.5 rounded-[12px] bg-violet text-[15px] font-medium text-white shadow-[0_6px_18px_rgba(109,74,255,0.32)] transition hover:bg-[#5d3df0] disabled:opacity-80">
              {pending ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <span>Sign in</span>
              )}
            </button>
          </form>
          <div className="mt-4 text-center text-[13px] text-muted">
            <button onClick={() => switchMode("magic")} className="cursor-pointer font-medium text-violet">
              Email me a magic link instead
            </button>
          </div>
        </>
      ) : view === "form" ? (
        <>
          <form onSubmit={sendLink}>
            {ErrorBox}
            <label htmlFor="email" className={LABEL}>Work email</label>
            <input id="email" name="email" type="email" required autoComplete="email"
              placeholder="you@yourpractice.com" value={email} onChange={(e) => setEmail(e.target.value)}
              className={`${INPUT} mb-[18px]`} />
            <button type="submit" disabled={pending}
              className="flex h-12 w-full items-center justify-center gap-2.5 rounded-[12px] bg-violet text-[15px] font-medium text-white shadow-[0_6px_18px_rgba(109,74,255,0.32)] transition hover:bg-[#5d3df0] disabled:opacity-80">
              {pending ? (
                <>
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  <span>Sending link…</span>
                </>
              ) : (
                <span>Email me a magic link</span>
              )}
            </button>
          </form>
          <div className="mt-4 text-center text-[13px] text-muted">
            <button onClick={() => switchMode("password")} className="cursor-pointer font-medium text-violet">
              Prefer a password? Sign in with a password
            </button>
          </div>
        </>
      ) : (
        <div className="rounded-[16px] border border-lavender-deep bg-lavender px-[22px] py-6">
          <div className="bg-gradient-brand mb-4 flex h-[46px] w-[46px] items-center justify-center rounded-full">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M3 6.5 12 13l9-6.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="3" y="5" width="18" height="14" rx="3" stroke="#fff" strokeWidth="2" />
            </svg>
          </div>
          <div className="text-[19px] font-bold tracking-[-0.01em]">Check your inbox</div>
          <div className="mt-1.5 text-[14px] leading-[1.55] text-muted">
            We sent a magic link to <span className="font-medium text-ink">{email}</span>. Click it on
            this device and you’ll be signed straight into your workspace.
          </div>
          <div className="mt-4 text-center text-[13px] text-muted">
            Didn’t get it?{" "}
            <button onClick={() => startTransition(async () => { await sendMagicLink(email); })} disabled={pending}
              className="cursor-pointer font-medium text-violet disabled:opacity-60">
              Resend
            </button>{" "}
            ·{" "}
            <button onClick={() => switchMode("magic")} className="cursor-pointer font-medium text-violet">
              Use a different email
            </button>
          </div>
        </div>
      )}

      <div className="mt-[30px] text-center text-[12.5px] text-muted">
        Secured by Supabase · One workspace, your data only
      </div>
    </div>
  );
}
