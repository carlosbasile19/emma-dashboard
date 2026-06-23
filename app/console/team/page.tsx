import { TeamView } from "@/components/console/TeamView";
import { requireAdmin } from "@/lib/auth";
import { listAgencyTeam, listInvites } from "@/lib/olivia/agency";
import { getRequestOrigin } from "@/lib/origin";

export default async function ConsoleTeamPage() {
  const [ctx, team, invites, baseUrl] = await Promise.all([
    requireAdmin(),
    listAgencyTeam(),
    listInvites(),
    getRequestOrigin(),
  ]);
  return (
    <TeamView team={team} invites={invites} baseUrl={baseUrl} currentUserId={ctx.userId} />
  );
}
