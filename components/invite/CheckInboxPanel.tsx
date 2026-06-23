import Link from "next/link";

/**
 * Branded "check your inbox" success panel shown after an invitation is accepted — both the
 * client-side action result and the server re-render of an already-accepted invite land here, so
 * an accepted invite never reads as the scary "already used" error. Pure markup (no client hooks),
 * usable from both server and client components. Rendered inside the invite card shell.
 */
export function CheckInboxPanel({ email }: { email: string }) {
  return (
    <div className="text-center">
      <div className="bg-gradient-brand mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full shadow-[0_6px_18px_rgba(109,74,255,0.32)]">
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="m3 7 9 6 9-6" />
        </svg>
      </div>
      <h1 className="text-[20px] font-bold tracking-[-0.01em]">Check your inbox</h1>
      <p className="mt-2 text-[14px] leading-[1.55] text-muted">
        Your invitation is accepted. We&apos;ve emailed a one-click sign-in link to{" "}
        <span className="font-medium text-ink">{email}</span>. Open it to sign in to Hey Emma.
      </p>
      <Link
        href="/login"
        className="mt-6 inline-block font-display text-[13px] font-medium text-violet hover:underline"
      >
        Go to sign in →
      </Link>
    </div>
  );
}
