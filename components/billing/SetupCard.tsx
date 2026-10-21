import { startLinkCheckout } from "@/app/billing/setup/actions";
import { LogoWordmark } from "@/components/brand/Logo";
import { SubmitButton } from "@/components/ui/states/SubmitButton";
import { chargeSummary, mandateText, type ChargeTerms } from "@/lib/billing/copy";

/**
 * The public card-setup card. Server component: the form posts to a server action, so no
 * client JS beyond SubmitButton's pending state. The mandate sits under the button so the
 * off-session authorisation is on screen before Checkout opens.
 */
export function SetupCard({
  token,
  clientName,
  terms,
  cancelled,
  incomplete,
  failed,
}: {
  token: string;
  clientName: string;
  /** The agency's own fee, currency and day. Emma's wholesale price is never passed here. */
  terms: ChargeTerms;
  cancelled: boolean;
  incomplete: boolean;
  failed: boolean;
}) {
  return (
    <div>
      <div className="mb-6">
        <LogoWordmark size={32} />
      </div>
      <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-violet">
        Billing setup
      </div>
      <h1 className="text-[22px] font-bold tracking-[-0.01em]">Add a card for {clientName}</h1>
      <p className="mt-2.5 text-[14px] leading-[1.55] text-muted">{chargeSummary(terms)}</p>

      {cancelled ? (
        <div className="mt-4 rounded-[10px] border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-[13px] text-ink/80">
          No card was added. You can try again whenever you&apos;re ready.
        </div>
      ) : null}

      {incomplete ? (
        <div className="mt-4 rounded-[10px] border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-[13px] text-ink/80">
          Your card setup wasn&apos;t completed, so no card was added. Please try again.
        </div>
      ) : null}

      {failed ? (
        <div className="mt-4 rounded-[10px] border border-danger/30 bg-danger/8 px-3.5 py-2.5 text-[13px] text-danger">
          We couldn&apos;t open the secure card form. Please try again in a moment or contact Hey
          Emma.
        </div>
      ) : null}

      <form action={startLinkCheckout} className="mt-6">
        <input type="hidden" name="token" value={token} />
        <SubmitButton
          pendingLabel="Opening secure checkout…"
          className="bg-gradient-brand w-full rounded-[12px] py-3 font-display text-[14px] font-semibold text-white shadow-[0_4px_14px_rgba(109,74,255,0.35)] transition-transform active:scale-[0.99]"
        >
          Add card with Stripe
        </SubmitButton>
      </form>

      <p className="mt-4 text-[12px] leading-[1.55] text-muted">{mandateText(terms)}</p>
    </div>
  );
}
