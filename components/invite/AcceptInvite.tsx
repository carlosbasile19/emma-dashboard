"use client";

import { useActionState } from "react";
import { acceptInvite, type AcceptState } from "@/app/invite/actions";
import { CheckInboxPanel } from "@/components/invite/CheckInboxPanel";
import { LogoWordmark } from "@/components/brand/Logo";

export function AcceptInvite({
  token,
  clientName,
  email,
  isTeam = false,
}: {
  token: string;
  clientName: string;
  email: string;
  isTeam?: boolean;
}) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptInvite, {});

  if (state.ok) {
    return <CheckInboxPanel email={state.email ?? email} />;
  }

  return (
    <div>
      <div className="mb-6">
        <LogoWordmark size={32} />
      </div>
      <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-violet">
        {isTeam ? "Agency invitation" : "Workspace invitation"}
      </div>
      <h1 className="text-[22px] font-bold tracking-[-0.01em]">
        {isTeam ? "Join the agency team" : `Join ${clientName}`}
      </h1>
      <p className="mt-2.5 text-[14px] leading-[1.55] text-muted">
        {isTeam ? (
          <>
            You&apos;ve been invited to the Hey Emma agency console with admin access to every
            client.
          </>
        ) : (
          <>
            You&apos;ve been invited to the Hey Emma workspace for{" "}
            <span className="font-medium text-ink">{clientName}</span>.
          </>
        )}{" "}
        We&apos;ll set up your account for{" "}
        <span className="font-medium text-ink">{email}</span> and email you a one-click sign-in
        link.
      </p>

      {state.error ? (
        <div className="mt-4 rounded-[10px] border border-danger/30 bg-danger/8 px-3.5 py-2.5 text-[13px] text-danger">
          {state.error}
        </div>
      ) : null}

      <form action={action} className="mt-6">
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          disabled={pending}
          className="bg-gradient-brand w-full rounded-[12px] py-3 font-display text-[14px] font-semibold text-white shadow-[0_4px_14px_rgba(109,74,255,0.35)] transition-transform active:scale-[0.99] disabled:opacity-60"
        >
          {pending ? "Setting up your account…" : "Accept invitation"}
        </button>
      </form>
    </div>
  );
}
