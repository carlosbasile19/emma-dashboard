import { InvitesView } from "@/components/console/InvitesView";
import { listAgencyClients, listInvites, listMembers } from "@/lib/olivia/agency";
import { getRequestOrigin } from "@/lib/origin";

export default async function ConsoleInvitesPage() {
  const [invites, members, clients, baseUrl] = await Promise.all([
    listInvites(),
    listMembers(),
    listAgencyClients(),
    getRequestOrigin(),
  ]);
  return <InvitesView invites={invites} members={members} clients={clients} baseUrl={baseUrl} />;
}
