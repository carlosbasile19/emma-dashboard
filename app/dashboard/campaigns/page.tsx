import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/states/EmptyState";
import { ErrorState } from "@/components/ui/states/ErrorState";
import { FreshnessNote } from "@/components/ui/FreshnessNote";
import { EMPTY_COPY, ERROR_COPY } from "@/lib/copy";
import { num, pct } from "@/lib/format";
import { fetchCampaigns } from "@/lib/olivia/service";

export default async function CampaignsPage() {
  let result;
  try {
    result = await fetchCampaigns();
  } catch {
    return <ErrorState copy={ERROR_COPY.campaigns} />;
  }

  const campaigns = result.data;
  if (campaigns.length === 0) {
    return <EmptyState copy={EMPTY_COPY.campaigns} />;
  }

  return (
    <>
      <FreshnessNote freshness={result.freshness} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-4">
        {campaigns.map((c) => (
          <Card key={c.id} className="px-[22px] py-5">
            <div style={{ opacity: c.status === "draft" ? 0.55 : 1 }}>
              <div className="mb-[18px] flex items-start justify-between gap-2.5">
                <h3 className="m-0 text-base font-medium leading-[1.3]">{c.name}</h3>
                <Badge kind="campaign" value={c.status} />
              </div>

              <div className="mb-[18px] grid grid-cols-3 gap-x-2 gap-y-3.5">
                <Stat label="Leads" value={num(c.leads_total)} />
                <Stat label="Contacted" value={num(c.leads_contacted)} />
                <Stat label="Replies" value={num(c.replies)} />
                <Stat label="Appts booked" value={num(c.appointments_booked)} accent />
                <Stat label="Opt-outs" value={num(c.opt_outs)} />
                <div />
              </div>

              <div className="flex gap-2.5 border-t border-lavender pt-4">
                <div className="flex-1 rounded-[10px] bg-success/[0.08] px-3 py-2.5">
                  <div className="font-mono text-base text-success">{pct(c.reply_rate)}</div>
                  <div className="mt-0.5 text-[11px] text-muted">Reply rate</div>
                </div>
                <div className="flex-1 rounded-[10px] bg-warning/[0.09] px-3 py-2.5">
                  <div className="font-mono text-base text-[#C2811F]">{pct(c.opt_out_rate)}</div>
                  <div className="mt-0.5 text-[11px] text-muted">Opt-out rate</div>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className={`font-mono text-lg ${accent ? "text-violet" : ""}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-muted">{label}</div>
    </div>
  );
}
