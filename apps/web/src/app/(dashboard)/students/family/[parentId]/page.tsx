import { notFound } from "next/navigation";
import { getFamily } from "@/lib/queries/families";
import { payLink } from "@/lib/app-url";
import { FamilyPage } from "@/components/family-page";

// Every dashboard page reads live business data behind a login, so it must be
// rendered per request. Without this Next prerenders it at build time and the
// page keeps serving whatever the database held when it was deployed.
export const dynamic = "force-dynamic";

export default async function FamilyRoute({ params }: { params: { parentId: string } }) {
  // Not a family's id at all (an old bookmark, a typo): there is no such page.
  if (!/^[0-9a-f-]{36}$/i.test(params.parentId)) notFound();

  const family = await getFamily(params.parentId);
  if (!family) notFound();

  return <FamilyPage family={family} payLink={payLink(family.parent.pay_token)} />;
}
