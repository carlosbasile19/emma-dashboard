import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/brand/Logo";
import config from "@/config";

// Public marketing landing page (indexable, unlike the private dashboard).
export const metadata: Metadata = {
  title: "Every call answered. Every lead chased.",
  description: config.appDescription,
  robots: { index: true, follow: true },
};

const STEPS = [
  {
    n: "01",
    title: "Connect your lines",
    body: "Forward your number and link your forms, Instagram, WhatsApp and inbox. No new hardware.",
    icon: (
      <path d="M12 3v18M3 12h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    ),
  },
  {
    n: "02",
    title: "Emma learns your business",
    body: "Hours, services, pricing, FAQs and booking rules — in your voice. Approve it and she's ready.",
    icon: (
      <>
        <path d="M12 2a4 4 0 0 1 4 4v5a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
  },
  {
    n: "03",
    title: "She answers & books",
    body: "Every call picked up, every lead chased, every booking synced to your calendar and CRM.",
    icon: (
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    ),
  },
];

const CHANNELS = [
  { title: "Phone calls", body: "Picks up on the first ring, day or night. Natural voice, real answers, instant bookings.", icon: <path d="M5 4h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" /> },
  { title: "Text & SMS", body: "Replies in seconds, follows up persistently, and nudges no-shows back onto the calendar.", icon: <path d="M4 5h16v11H8l-4 4V5Z" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" /> },
  { title: "DMs", body: "Instagram and WhatsApp messages answered the moment they land — never left on read.", icon: <><rect x="3" y="3" width="18" height="18" rx="5" stroke="#fff" strokeWidth="1.8" /><circle cx="12" cy="12" r="4" stroke="#fff" strokeWidth="1.8" /><circle cx="17.5" cy="6.5" r="1.2" fill="#fff" /></> },
  { title: "Email", body: "Quotes, reminders and tidy follow-ups that sound like your team — sent at the right moment.", icon: <><rect x="3" y="5" width="18" height="14" rx="3" stroke="#fff" strokeWidth="1.8" /><path d="m3 7 9 6 9-6" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" /></> },
];

const FEATURES = [
  { dot: "bg-violet", title: "Books straight to your calendar", body: "Real-time availability, deposits, and confirmations — synced to Google, Outlook or your PMS." },
  { dot: "bg-pink", title: "Never-cold follow-up", body: "Smart cadences chase every lead until they book, reply, or ask to stop. Nothing slips." },
  { dot: "bg-violet-light", title: "Call recordings & transcripts", body: "Listen back, read the transcript and see the disposition for every conversation." },
  { dot: "bg-success", title: "Smart escalation", body: "When something needs a human, Emma warm-transfers or flags your team instantly." },
  { dot: "bg-warning", title: "Knows your business", body: "Hours, services, pricing and policies — answered accurately, in your tone of voice." },
  { dot: "bg-ink", title: "One clean dashboard", body: "Leads, calls, bookings and revenue in one workspace — your data, only ever yours." },
];

const PROBLEMS = [
  { stat: "78%", color: "text-pink", body: <>of callers <span className="font-medium text-ink">won&apos;t leave a voicemail</span> — they just call the next business.</> },
  { stat: "5min", color: "text-violet", body: <>is all you get. Reply later and you&apos;re <span className="font-medium text-ink">10× less likely</span> to ever connect.</> },
  { stat: "35%", color: "text-warning", body: <>of inbound calls to local businesses <span className="font-medium text-ink">go unanswered</span> in a typical week.</> },
];

function Eyebrow({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`font-mono text-xs uppercase tracking-[0.14em] ${accent ? "text-pink" : "text-violet"}`}>
      {children}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-warm">
      {/* NAV */}
      <header className="sticky top-0 z-40 border-b border-ink/10 bg-warm/80 backdrop-blur-[12px]">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-6 px-7 py-3.5">
          <div className="flex items-center gap-[11px]">
            <LogoMark size={34} />
            <div className="text-[18px] font-medium tracking-[-0.01em]">
              <span className="text-muted">Hey</span> <span className="font-bold text-ink">Emma</span>
            </div>
          </div>
          <nav className="hidden items-center gap-[30px] text-[14.5px] text-muted md:flex">
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#channels" className="hover:text-ink">Channels</a>
            <a href="#features" className="hover:text-ink">Features</a>
          </nav>
          <div className="flex items-center gap-3.5">
            <Link href="/login" className="text-[14.5px] font-medium text-ink hover:text-violet">
              Sign in
            </Link>
            <Link href="/login" className="rounded-[11px] bg-ink px-[18px] py-2.5 text-sm font-medium text-white hover:bg-[#243a3e]">
              Get a demo
            </Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative mx-auto max-w-[1180px] px-7 pb-[70px] pt-[84px]">
        <div className="pointer-events-none absolute -right-32 -top-32 h-[540px] w-[540px] rounded-full bg-[radial-gradient(circle,rgba(109,74,255,0.16),transparent_64%)]" />
        <div className="pointer-events-none absolute -bottom-40 -left-32 h-[480px] w-[480px] rounded-full bg-[radial-gradient(circle,rgba(255,61,119,0.12),transparent_66%)]" />
        <div className="relative grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="inline-flex items-center gap-2.5 rounded-full border border-lavender-deep bg-lavender px-3.5 py-1.5 font-mono text-[11.5px] uppercase tracking-[0.1em] text-violet">
              <span className="h-[7px] w-[7px] animate-[pulse_1.6s_infinite] rounded-full bg-success" /> Your outbound, on autopilot
            </div>
            <h1 className="mt-[22px] text-balance text-[44px] font-bold leading-[1.04] tracking-[-0.03em] sm:text-[56px]">
              Every call answered. Every lead chased. While you run the&nbsp;business.
            </h1>
            <p className="mt-[22px] max-w-[480px] text-[18px] leading-[1.55] text-muted">
              Emma is a voice-AI rep that picks up every call and follows up every lead in seconds —
              across call, text, DM and email. So no lead ever goes cold.
            </p>
            <div className="mt-8 flex flex-wrap gap-3.5">
              <Link href="/login" className="inline-flex items-center gap-2.5 rounded-[13px] bg-violet px-6 py-3.5 text-[15.5px] font-medium text-white shadow-[0_10px_26px_rgba(109,74,255,0.30)] hover:bg-[#5d3df0]">
                Book a 15-min demo
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </Link>
              <Link href="/login" className="inline-flex items-center gap-2 rounded-[13px] border border-ink/10 bg-white px-[22px] py-3.5 text-[15.5px] font-medium text-ink hover:border-violet hover:text-violet">
                See the dashboard
              </Link>
            </div>
            <div className="mt-10 flex gap-[34px] font-mono">
              {[["47%", "pickup rate"], ["<8s", "to first reply"], ["24/7", "never sleeps"]].map(([v, l], i) => (
                <div key={l} className="flex gap-[34px]">
                  {i > 0 && <div className="w-px bg-ink/10" />}
                  <div>
                    <div className="text-[26px] font-bold text-ink">{v}</div>
                    <div className="mt-1 text-[11px] uppercase tracking-[0.08em] text-muted">{l}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* product call card mock */}
          <div className="relative">
            <div className="bg-gradient-brand absolute -inset-[18px] rounded-[28px] opacity-10 blur-[8px]" />
            <div className="relative overflow-hidden rounded-[22px] border border-ink/10 bg-white shadow-[0_24px_60px_rgba(26,43,46,0.14)]">
              <div className="bg-gradient-brand h-1" />
              <div className="flex items-center justify-between border-b border-ink/10 px-5 py-[18px]">
                <div className="flex items-center gap-[11px]">
                  <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px] bg-lavender text-violet">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 4h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
                  </div>
                  <div>
                    <div className="text-[14.5px] font-bold">Live call · Maria G.</div>
                    <div className="font-mono text-[11px] text-muted">Inbound · 00:42</div>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-[11px] py-1 text-xs font-medium text-success">
                  <span className="h-1.5 w-1.5 animate-[pulse_1.4s_infinite] rounded-full bg-success" /> Connected
                </span>
              </div>
              <div className="flex flex-col gap-3 px-5 py-[18px]">
                <div className="flex items-end gap-2.5">
                  <div className="h-7 w-7 flex-none rounded-lg bg-lavender" />
                  <div className="max-w-[74%] rounded-[14px_14px_14px_4px] border border-ink/10 bg-warm px-3 py-2.5 text-[13.5px]">
                    Hi, I saw you do same-day crowns — do you have anything this week?
                  </div>
                </div>
                <div className="flex flex-row-reverse items-end gap-2.5">
                  <div className="bg-gradient-brand h-7 w-7 flex-none rounded-lg" />
                  <div className="max-w-[74%] rounded-[14px_14px_4px_14px] border border-lavender-deep bg-lavender px-3 py-2.5 text-[13.5px] text-ink">
                    We do! I can get you in Thursday at 2pm with Dr. Okafor. Want me to lock it in?
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-[12px] border border-dashed border-success/35 bg-success/[0.07] px-3 py-[11px]">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#2BB673" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <div className="text-[13px] font-medium text-ink">Booked — Thu 2:00pm · synced to calendar &amp; CRM</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST BAR */}
      <section className="border-y border-ink/10 bg-white">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-center gap-x-10 gap-y-3 px-7 py-[22px] font-mono text-[12.5px] tracking-[0.06em] text-muted">
          <span className="text-[11px] uppercase tracking-[0.14em]">Built for front desks at</span>
          {["Dental", "Med-spa", "Home services", "Auto", "Real estate"].map((s) => (
            <span key={s} className="font-bold text-ink">{s}</span>
          ))}
        </div>
      </section>

      {/* PROBLEM */}
      <section className="mx-auto max-w-[1180px] px-7 pb-5 pt-[84px]">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <div>
            <Eyebrow accent>The leak</Eyebrow>
            <h2 className="mt-3.5 text-balance text-[38px] font-bold leading-[1.1] tracking-[-0.02em]">
              A missed call is a booked competitor.
            </h2>
            <p className="mt-[18px] text-[17px] leading-[1.6] text-muted">
              Most jobs go to whoever replies first — and after 5 minutes your odds of reaching a lead
              fall off a cliff. Your team can&apos;t be on the phone, on Instagram and on email at 9pm. Emma can.
            </p>
          </div>
          <div className="flex flex-col gap-3.5">
            {PROBLEMS.map((p) => (
              <div key={p.stat} className="flex items-center gap-4 rounded-[16px] border border-ink/10 bg-white px-5 py-[18px]">
                <div className={`min-w-[74px] font-mono text-[30px] font-bold ${p.color}`}>{p.stat}</div>
                <div className="text-[14.5px] leading-[1.5] text-muted">{p.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="mx-auto max-w-[1180px] px-7 pb-5 pt-[84px]">
        <div className="mx-auto max-w-[640px] text-center">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-3.5 text-balance text-[38px] font-bold leading-[1.1] tracking-[-0.02em]">
            Live in a day. Working in seconds.
          </h2>
          <p className="mt-4 text-[17px] leading-[1.6] text-muted">
            Point Emma at your phone number and lead sources. She handles the rest.
          </p>
        </div>
        <div className="mt-12 grid gap-[22px] md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-[18px] border border-ink/10 bg-white px-6 py-7">
              <div className="font-mono text-[13px] font-bold text-violet">{s.n}</div>
              <div className="my-4 flex h-[46px] w-[46px] items-center justify-center rounded-[13px] bg-lavender text-violet">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">{s.icon}</svg>
              </div>
              <div className="text-[18px] font-bold tracking-[-0.01em]">{s.title}</div>
              <p className="mt-2 text-[14.5px] leading-[1.55] text-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CHANNELS */}
      <section id="channels" className="mx-auto max-w-[1180px] px-7 pb-5 pt-[84px]">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-[560px]">
            <Eyebrow accent>Every channel</Eyebrow>
            <h2 className="mt-3.5 text-balance text-[38px] font-bold leading-[1.1] tracking-[-0.02em]">
              One rep across every way a lead reaches you.
            </h2>
          </div>
          <p className="max-w-[320px] text-[15px] leading-[1.55] text-muted">
            Emma keeps one thread per person — so a call, a DM and an email all stay in the same conversation.
          </p>
        </div>
        <div className="mt-[42px] grid gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
          {CHANNELS.map((c) => (
            <div key={c.title} className="rounded-[18px] border border-ink/10 bg-white px-[22px] py-6">
              <div className="bg-gradient-brand mb-[18px] flex h-11 w-11 items-center justify-center rounded-[12px]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">{c.icon}</svg>
              </div>
              <div className="text-[17px] font-bold">{c.title}</div>
              <p className="mt-[7px] text-[13.5px] leading-[1.55] text-muted">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="mx-auto max-w-[1180px] px-7 pb-5 pt-[84px]">
        <div className="mx-auto max-w-[620px] text-center">
          <Eyebrow>What&apos;s inside</Eyebrow>
          <h2 className="mt-3.5 text-balance text-[38px] font-bold leading-[1.1] tracking-[-0.02em]">
            Everything a great front desk does — at machine speed.
          </h2>
        </div>
        <div className="mt-[46px] grid gap-[18px] md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-[18px] border border-ink/10 bg-white px-[22px] py-6">
              <div className="flex items-center gap-2.5 text-[16.5px] font-bold">
                <span className={`h-2 w-2 rounded-[2px] ${f.dot}`} />
                {f.title}
              </div>
              <p className="mt-2.5 text-sm leading-[1.55] text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* METRICS BAND */}
      <section className="mx-auto mt-[84px] max-w-[1180px] px-7">
        <div className="relative overflow-hidden rounded-[26px] bg-ink px-12 py-[60px]">
          <div className="absolute -right-32 -top-52 h-[480px] w-[480px] rounded-full bg-[radial-gradient(circle,rgba(109,74,255,0.45),transparent_62%)]" />
          <div className="absolute -bottom-56 -left-24 h-[440px] w-[440px] rounded-full bg-[radial-gradient(circle,rgba(255,61,119,0.30),transparent_64%)]" />
          <div className="relative mx-auto mb-11 max-w-[560px] text-center">
            <div className="font-mono text-xs uppercase tracking-[0.16em] text-violet-light">By the numbers</div>
            <h2 className="mt-3.5 text-balance text-[34px] font-bold leading-[1.12] tracking-[-0.02em] text-white">
              What changes the week Emma turns on.
            </h2>
          </div>
          <div className="relative grid grid-cols-2 gap-5 md:grid-cols-4">
            {[["100%", "of calls answered"], ["<8s", "first reply, any channel"], ["+38%", "more booked jobs"], ["24/7", "nights & weekends covered"]].map(([v, l]) => (
              <div key={l} className="text-center">
                <div className="font-mono text-[42px] font-bold text-white">{v}</div>
                <div className="mt-1.5 text-[13px] text-[#8FA1A3]">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TESTIMONIAL */}
      <section className="mx-auto max-w-[900px] px-7 pb-5 pt-[84px] text-center">
        <Eyebrow accent>From the front desk</Eyebrow>
        <p className="mt-[22px] text-balance text-[30px] font-medium leading-[1.32] tracking-[-0.01em]">
          &ldquo;We stopped losing the 6pm callers. Emma books them while we&apos;re cleaning up — it&apos;s like
          hiring a receptionist who never clocks out.&rdquo;
        </p>
        <div className="mt-7 flex items-center justify-center gap-3">
          <div className="bg-gradient-brand h-[42px] w-[42px] rounded-full" />
          <div className="text-left">
            <div className="text-[15px] font-bold">Jordan Bell</div>
            <div className="text-[13px] text-muted">Practice Manager · Brightwater Dental</div>
          </div>
        </div>
      </section>

      {/* CTA + FOOTER */}
      <section className="mx-auto max-w-[1180px] px-7 pb-[70px] pt-[84px]">
        <div className="flex flex-col items-center gap-5 rounded-[26px] border border-ink/10 bg-white px-7 py-14 text-center">
          <h2 className="text-balance text-[34px] font-bold leading-[1.1] tracking-[-0.02em]">
            Stop losing leads to whoever picks up first.
          </h2>
          <p className="max-w-[460px] text-[16px] leading-[1.55] text-muted">
            See Emma answer a call, book it, and sync it to your calendar — in a 15-minute demo.
          </p>
          <Link href="/login" className="inline-flex items-center gap-2.5 rounded-[13px] bg-violet px-6 py-3.5 text-[15.5px] font-medium text-white shadow-[0_10px_26px_rgba(109,74,255,0.30)] hover:bg-[#5d3df0]">
            Book a 15-min demo
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </Link>
        </div>
      </section>

      <footer className="border-t border-ink/10 bg-white">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-6 px-7 py-9">
          <div className="flex items-center gap-[11px]">
            <LogoMark size={28} />
            <div className="text-[15px]"><span className="text-muted">Hey</span> <span className="font-bold">Emma</span></div>
          </div>
          <div className="flex gap-[26px] text-[13.5px] text-muted">
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#features" className="hover:text-ink">Features</a>
            <Link href="/login" className="hover:text-ink">Sign in</Link>
          </div>
          <div className="font-mono text-[11.5px] text-muted">© 2026 Emma · Passwordless &amp; secure</div>
        </div>
      </footer>
    </div>
  );
}
