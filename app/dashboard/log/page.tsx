import { LogView } from "@/components/dashboard/log/LogView";
import { sampleCalls, sampleConversations } from "@/lib/sample-data";

type SP = Promise<Record<string, string | string[] | undefined>>;

const PER = 8;
const str = (v: string | string[] | undefined, d: string) =>
  typeof v === "string" ? v : d;

export default async function LogPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const tab = str(sp.tab, "calls") === "conversations" ? "conversations" : "calls";

  const callTotal = sampleCalls.length;
  const callPages = Math.max(1, Math.ceil(callTotal / PER));
  const callPage = Math.min(Math.max(1, Number(str(sp.page, "1")) || 1), callPages);
  const calls = sampleCalls.slice((callPage - 1) * PER, callPage * PER);

  return (
    <LogView
      tab={tab}
      calls={calls}
      callTotal={callTotal}
      callPage={callPage}
      callPages={callPages}
      conversations={sampleConversations}
    />
  );
}
