"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

// Phase 2: local-only submit that routes into the dashboard.
// Phase 3 replaces handleSubmit with a Supabase email/password sign-in (server action).
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("loading");
    // Placeholder auth — wired to Supabase in Phase 3.
    await new Promise((r) => setTimeout(r, 700));
    router.push("/dashboard");
  }

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

      {status === "error" ? (
        <div className="mb-[18px] flex items-start gap-2.5 rounded-[12px] border border-danger/30 bg-danger/[0.08] px-3.5 py-3">
          <div className="mt-px flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-danger font-mono text-xs text-white">
            !
          </div>
          <div>
            <div className="text-[13.5px] font-medium text-[#B8323A]">
              That didn’t match.
            </div>
            <div className="mt-0.5 text-[13px] text-muted">
              Check your email and password, then try again.
            </div>
          </div>
        </div>
      ) : null}

      <form onSubmit={handleSubmit}>
        <label className="mb-[7px] block font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
          Email
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="mb-4 h-[46px] w-full rounded-[12px] border border-ink/10 bg-white px-3.5 font-display text-[15px] text-ink outline-none focus:border-violet focus:shadow-[0_0_0_3px_rgba(109,74,255,0.14)]"
        />

        <label className="mb-[7px] block font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
          Password
        </label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
          disabled={status === "loading"}
          className="flex h-12 w-full items-center justify-center gap-2.5 rounded-[12px] bg-violet text-[15px] font-medium text-white shadow-[0_6px_18px_rgba(109,74,255,0.32)] transition hover:bg-[#5d3df0] disabled:opacity-80"
        >
          {status === "loading" ? (
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            <span>{status === "error" ? "Try again" : "Sign in to Emma"}</span>
          )}
        </button>
      </form>

      <div className="mt-[30px] text-center text-[12.5px] text-muted">
        Secured by Supabase · One workspace, your data only
      </div>
    </div>
  );
}
