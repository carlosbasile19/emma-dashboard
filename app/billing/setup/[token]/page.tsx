import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SetupCard } from "@/components/billing/SetupCard";
import { LogoWordmark } from "@/components/brand/Logo";
import { billingFeatureEnabled, loadClientBilling, type CardOnFile } from "@/lib/billing/config";
import { cardLabel, clientDisplayName } from "@/lib/billing/notify";
import { getSetupLink, reconcileCheckoutSession } from "@/lib/billing/setup";
import { getRequestOrigin } from "@/lib/origin";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

const COPY = {
  invalid: "This billing link isn't valid.",
  expired: "This billing link has expired. Ask your Hey Emma administrator for a new one.",
  revoked: "This billing link was revoked.",
  failed:
    "We couldn't confirm your card. Please try again or contact Hey Emma if it keeps happening.",
} as const;

/**
 * Public, token-gated card setup. Three states: a valid link shows the card; a completed link
 * (or a return from Stripe with `session_id`) confirms the card; anything else explains why
 * the link can't be used. Reconciling on return is idempotent, so a refresh is harmless.
 * Every reconcile outcome renders a screen — none throws to the client.
 */
export default async function BillingSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: SP;
}) {
  if (!billingFeatureEnabled()) notFound();
  const { token } = await params;
  const sp = await searchParams;
  const found = await getSetupLink(token);

  let body: ReactNode;
  if (!found) {
    body = <Unavailable reason={COPY.invalid} />;
  } else {
    const { link, state } = found;
    const clientName = await clientDisplayName(link.clientId);
    const sessionId = one(sp.session_id);
    let incomplete = false;
    body = null;

    if (sessionId && (state === "valid" || state === "completed")) {
      const result = await reconcileCheckoutSession(sessionId, link.clientId, await getRequestOrigin());
      if (result.ok) {
        body = <Done clientName={clientName} card={result.card} />;
      } else {
        switch (result.reason) {
          case "already_adopted":
            // Another caller (the webhook) adopted the card first; it is on file.
            body = <Done clientName={clientName} card={null} />;
            break;
          case "incomplete":
            incomplete = true; // fall through to the start screen below (if the link is still valid)
            break;
          case "link_revoked":
            body = <Unavailable reason={COPY.revoked} />;
            break;
          case "link_expired":
            body = <Unavailable reason={COPY.expired} />;
            break;
          case "link_invalid":
            body = <Unavailable reason={COPY.invalid} />;
            break;
          default:
            console.error("billing setup: reconcile failed", result.reason);
            body = <Unavailable title="We couldn't confirm your card" reason={COPY.failed} />;
        }
      }
    }

    if (!body) {
      if (state === "completed") {
        body = <Done clientName={clientName} card={null} />;
      } else if (state === "expired") {
        body = <Unavailable reason={COPY.expired} />;
      } else if (state === "revoked") {
        body = <Unavailable reason={COPY.revoked} />;
      } else if (state !== "valid") {
        body = <Unavailable reason={COPY.invalid} />;
      } else {
        const cb = await loadClientBilling(link.clientId);
        body = (
          <SetupCard
            token={token}
            clientName={clientName}
            feeCents={cb?.effective.feeCents ?? 0}
            anchorDay={cb?.effective.anchorDay ?? 3}
            cancelled={one(sp.setup) === "cancelled"}
            incomplete={incomplete}
            failed={one(sp.error) === "failed"}
            disabled={!cb?.enabled || one(sp.error) === "disabled"}
          />
        );
      }
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-warm px-6">
      <div className="pointer-events-none absolute -right-40 -top-44 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgba(109,74,255,0.18),transparent_64%)]" />
      <div className="pointer-events-none absolute -bottom-52 -left-36 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(255,61,119,0.12),transparent_64%)]" />
      <div className="relative w-full max-w-[420px] rounded-[20px] border border-ink/10 bg-white p-8 shadow-[0_12px_32px_rgba(26,43,46,0.12)]">
        {body}
      </div>
    </main>
  );
}

function Done({ clientName, card }: { clientName: string; card: CardOnFile | null }) {
  return (
    <div className="text-center">
      <div className="mb-6 flex justify-center">
        <LogoWordmark size={32} />
      </div>
      <div className="bg-gradient-brand mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full shadow-[0_6px_18px_rgba(109,74,255,0.32)]">
        <svg width="26" height="26" viewBox="0 0 20 20" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 10.5l3.2 3.2L15 7" />
        </svg>
      </div>
      <h1 className="text-[20px] font-bold tracking-[-0.01em]">Card added</h1>
      <p className="mt-2 text-[14px] leading-[1.55] text-muted">
        {card ? (
          <>
            <span className="font-medium text-ink">{cardLabel(card)}</span> is now on file for{" "}
            {clientName}.
          </>
        ) : (
          <>A card is on file for {clientName}.</>
        )}{" "}
        Automatic billing will use it from the next charge date. You can close this page.
      </p>
    </div>
  );
}

function Unavailable({ reason, title = "Link unavailable" }: { reason: string; title?: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-lavender-deep bg-lavender text-violet">
        <svg width="26" height="26" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
          <rect x="4" y="9" width="12" height="8" rx="2" />
          <path d="M7 9V6a3 3 0 016 0v3" />
        </svg>
      </div>
      <h1 className="text-[20px] font-bold tracking-[-0.01em]">{title}</h1>
      <p className="mt-2 text-[14px] leading-[1.55] text-muted">{reason}</p>
      <Link href="/login" className="mt-6 inline-block font-display text-[13px] font-medium text-violet hover:underline">
        Go to sign in →
      </Link>
    </div>
  );
}
