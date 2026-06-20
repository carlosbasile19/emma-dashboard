import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";
import { LogoMark } from "@/components/brand/Logo";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* left brand panel */}
      <div className="relative hidden min-h-screen flex-col justify-between overflow-hidden bg-ink p-14 lg:flex">
        <div className="absolute -right-40 -top-44 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgba(109,74,255,0.55),transparent_62%)] blur-[8px]" />
        <div className="absolute -bottom-52 -left-36 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(255,61,119,0.34),transparent_64%)]" />
        <div className="absolute -bottom-16 left-[40%] h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(164,139,255,0.18),transparent_66%)]" />

        <div className="relative flex items-center gap-3">
          <LogoMark size={34} />
          <div className="whitespace-nowrap text-[19px] font-medium tracking-[-0.01em]">
            <span className="text-[#9DB0B2]">Hey</span>{" "}
            <span className="font-bold text-white">Emma</span>
          </div>
        </div>

        <div className="relative max-w-[440px]">
          <div className="mb-[22px] font-mono text-xs uppercase tracking-[0.16em] text-violet-light">
            Your outbound, on autopilot
          </div>
          <div className="text-[42px] font-bold leading-[1.08] tracking-[-0.02em] text-white text-balance">
            Every call answered. Every lead chased. While you run the practice.
          </div>
          <div className="mt-[22px] max-w-[400px] text-base leading-[1.55] text-[#B7C3C4]">
            A voice AI rep that picks up every call and follows up every lead in
            seconds — across call, text, DM and email. So no lead goes cold.
          </div>
        </div>

        <div className="relative flex gap-[30px] font-mono">
          <div>
            <div className="text-2xl text-white">47%</div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.08em] text-[#8FA1A3]">
              pickup rate
            </div>
          </div>
          <div>
            <div className="text-2xl text-white">&lt;8s</div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.08em] text-[#8FA1A3]">
              to first reply
            </div>
          </div>
          <div>
            <div className="text-2xl text-white">24/7</div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.08em] text-[#8FA1A3]">
              never sleeps
            </div>
          </div>
        </div>
      </div>

      {/* right form panel */}
      <div className="flex min-h-screen items-center justify-center p-10">
        <LoginForm />
      </div>
    </div>
  );
}
