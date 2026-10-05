import { NewProgramWizard } from "@/components/new-program-wizard";
import { getNewProgramContext } from "@/lib/queries/new-program";

export const dynamic = "force-dynamic";

/**
 * New program — and, with ?program=<id>, "Add to another school"; with
 * ?program=<id>&from=<season id>, "Duplicate for next season".
 */
export default async function NewProgramPage({ searchParams }: { searchParams: { program?: string; from?: string } }) {
  const ctx = await getNewProgramContext();
  return <NewProgramWizard ctx={ctx} programId={searchParams.program ?? null} fromSeasonId={searchParams.from ?? null} />;
}
