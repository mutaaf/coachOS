import { ProgramsPageClient } from "@/components/programs-page-client";
import { getProgramsPage } from "@/lib/queries/catalog";

export const dynamic = "force-dynamic";

export default async function ProgramsPage() {
  return <ProgramsPageClient {...await getProgramsPage()} />;
}
