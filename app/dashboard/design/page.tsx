import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { CHART_PALETTE } from "@/lib/design";
import {
  BOOKING_STATUSES,
  CALL_DISPOSITIONS,
  CALL_STATUSES,
  CAMPAIGN_STATUSES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  type BadgeKind,
} from "@/lib/types";

const TOKEN_COLORS = [
  { name: "warm", hex: "#F7F5F2", use: "Page background — the calm field" },
  { name: "ink", hex: "#1A2B2E", use: "Primary text, hero & footer surfaces" },
  { name: "muted", hex: "#5C6B6D", use: "Secondary copy, captions" },
  { name: "violet", hex: "#6D4AFF", use: "CTAs, interactive, key emphasis" },
  { name: "pink", hex: "#FF3D77", use: "One pop per view — sparingly" },
  { name: "violet-light", hex: "#A48BFF", use: "Text & links on dark only" },
  { name: "lavender", hex: "#ECEAF7", use: "Card tints, zebra, chart bands" },
  { name: "lavender-deep", hex: "#C9C2E8", use: "Borders & dividers" },
];

const STATUS_TOKENS = [
  { name: "success", hex: "#2BB673" },
  { name: "neutral", hex: "#5C6B6D" },
  { name: "warning", hex: "#E8A33D" },
  { name: "danger", hex: "#E5484D" },
];

const TYPE_SCALE = [
  { name: "display", sample: "Never miss a lead", px: "40px", mono: false, weight: 700 },
  { name: "h1", sample: "Campaign overview", px: "30px", mono: false, weight: 700 },
  { name: "h2", sample: "Leads by stage", px: "24px", mono: false, weight: 500 },
  { name: "h3", sample: "Recent calls", px: "18px", mono: false, weight: 500 },
  { name: "body", sample: "A voice rep that picks up every call.", px: "15px", mono: false, weight: 400 },
  { name: "label", sample: "PICKUP RATE", px: "12px", mono: true, weight: 400 },
  { name: "numeral", sample: "1,284", px: "34px", mono: true, weight: 500 },
];

const RADII = [
  { name: "sm", css: "8px" },
  { name: "md", css: "12px" },
  { name: "lg", css: "16px" },
  { name: "xl", css: "20px" },
  { name: "pill", css: "999px" },
];

const SHADOWS = [
  { name: "sm", css: "0 1px 2px rgba(26,43,46,.06)" },
  { name: "md", css: "0 4px 16px rgba(26,43,46,.08)" },
  { name: "lg", css: "0 12px 32px rgba(26,43,46,.12)" },
  { name: "ink", css: "0 18px 44px rgba(26,43,46,.28)" },
];

const BADGE_SETS: Array<{ title: string; kind: BadgeKind; values: readonly string[] }> = [
  { title: "Lead status / funnel", kind: "lead", values: LEAD_STATUSES },
  { title: "Lead source", kind: "source", values: LEAD_SOURCES },
  { title: "Call status", kind: "call", values: CALL_STATUSES },
  { title: "Call disposition", kind: "disp", values: CALL_DISPOSITIONS },
  { title: "Booking status", kind: "booking", values: BOOKING_STATUSES },
  { title: "Campaign status", kind: "campaign", values: CAMPAIGN_STATUSES },
];

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
    {children}
  </div>
);

export default function DesignSystemPage() {
  return (
    <div className="max-w-[1080px]">
      <div className="relative mb-[26px] overflow-hidden rounded-[16px] bg-ink px-8 py-[30px]">
        <div className="absolute -right-20 -top-40 h-[360px] w-[360px] rounded-full bg-[radial-gradient(circle,rgba(109,74,255,0.5),transparent_62%)]" />
        <div className="absolute -bottom-40 left-[30%] h-[300px] w-[300px] rounded-full bg-[radial-gradient(circle,rgba(255,61,119,0.30),transparent_64%)]" />
        <div className="relative">
          <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-violet-light">
            Emma · Design tokens
          </div>
          <div className="max-w-[620px] text-[30px] font-bold leading-[1.12] tracking-[-0.02em] text-white">
            A calm, warm field with one confident pop — fully tokenized, re-skinnable per
            client.
          </div>
          <div className="mt-3.5 max-w-[560px] text-[14.5px] text-[#B7C3C4]">
            Every value below is a named token wired into Tailwind via{" "}
            <span className="font-mono text-violet-light">@theme</span>.
          </div>
        </div>
      </div>

      <SectionLabel>Color · Foundation &amp; pops</SectionLabel>
      <div className="mb-[26px] grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3.5">
        {TOKEN_COLORS.map((c) => (
          <Card key={c.name} className="overflow-hidden">
            <div
              className="h-[72px] border-b border-ink/10"
              style={{ background: c.hex }}
            />
            <div className="px-3 py-[11px]">
              <div className="font-mono text-[13px] text-ink">{c.name}</div>
              <div className="mt-0.5 font-mono text-[11px] text-muted">{c.hex}</div>
              <div className="mt-1.5 text-[11.5px] leading-[1.35] text-muted">{c.use}</div>
            </div>
          </Card>
        ))}
      </div>

      <div className="mb-[26px] grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <Card className="p-4">
          <SectionLabel>gradient · signature</SectionLabel>
          <div className="bg-gradient-brand mb-2.5 h-12 rounded-[10px]" />
          <div className="font-mono text-[11px] text-muted">
            linear-gradient(100deg, #6D4AFF, #FF3D77)
          </div>
        </Card>
        <Card className="p-4">
          <SectionLabel>status · semantic</SectionLabel>
          <div className="flex gap-2.5">
            {STATUS_TOKENS.map((s) => (
              <div key={s.name} className="flex-1">
                <div className="h-10 rounded-[9px]" style={{ background: s.hex }} />
                <div className="mt-1.5 font-mono text-[11px] text-ink">{s.name}</div>
                <div className="font-mono text-[10px] text-muted">{s.hex}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mb-[26px] p-4">
        <SectionLabel>chart palette · categorical (color-blind aware)</SectionLabel>
        <div className="flex flex-wrap gap-2.5">
          {CHART_PALETTE.map((h, i) => (
            <div key={h} className="min-w-[90px] flex-1">
              <div className="h-11 rounded-[9px]" style={{ background: h }} />
              <div className="mt-1.5 font-mono text-[11px] text-ink">chart-{i + 1}</div>
              <div className="font-mono text-[10px] text-muted">{h}</div>
            </div>
          ))}
        </div>
      </Card>

      <SectionLabel>Type · Space Grotesk + Space Mono</SectionLabel>
      <Card className="mb-[26px] overflow-hidden">
        {TYPE_SCALE.map((t) => (
          <div
            key={t.name}
            className="flex items-baseline gap-5 border-b border-lavender px-[18px] py-3.5 last:border-0"
          >
            <div className="w-24 flex-none font-mono text-[11px] text-muted">{t.name}</div>
            <div
              className={`min-w-0 flex-1 truncate text-ink ${t.mono ? "font-mono" : "font-display"}`}
              style={{ fontSize: t.px, fontWeight: t.weight }}
            >
              {t.sample}
            </div>
            <div className="flex-none font-mono text-[11px] text-muted">{t.px}</div>
          </div>
        ))}
      </Card>

      <div className="mb-[26px] grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <Card className="p-4">
          <SectionLabel>radius</SectionLabel>
          <div className="flex flex-wrap gap-3">
            {RADII.map((r) => (
              <div key={r.name} className="text-center">
                <div
                  className="h-[46px] w-[46px] border border-lavender-deep bg-lavender"
                  style={{ borderRadius: r.css }}
                />
                <div className="mt-1.5 font-mono text-[10px] text-muted">{r.name}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <SectionLabel>shadow</SectionLabel>
          <div className="flex flex-wrap gap-4">
            {SHADOWS.map((s) => (
              <div key={s.name} className="text-center">
                <div
                  className="h-11 w-11 rounded-[10px] bg-white"
                  style={{ boxShadow: s.css }}
                />
                <div className="mt-2 font-mono text-[10px] text-muted">{s.name}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <SectionLabel>Status badges · every value</SectionLabel>
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        {BADGE_SETS.map((b) => (
          <Card key={b.title} className="px-4 py-[15px]">
            <div className="mb-[11px] text-[13px] font-medium">{b.title}</div>
            <div className="flex flex-wrap gap-2">
              {b.values.map((v) => (
                <Badge key={v} kind={b.kind} value={v} />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
