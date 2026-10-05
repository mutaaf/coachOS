import { NewProgramWizard } from "@/components/new-program-wizard";
import { getNewProgramContext } from "@/lib/queries/new-program";
import { getCoachClearances } from "@/lib/queries/coach-clearance";

export const dynamic = "force-dynamic";

/**
 * New program — and, with ?program=<id>, "Add to another school"; with
 * ?program=<id>&from=<season id>, "Duplicate for next season".
 */
export default async function NewProgramPage({ searchParams }: { searchParams: { program?: string; from?: string } }) {
  const [ctx, clearances] = await Promise.all([getNewProgramContext(), getCoachClearances({ activeOnly: true })]);
  return (
    <NewProgramWizard
      ctx={ctx}
      programId={searchParams.program ?? null}
      fromSeasonId={searchParams.from ?? null}
      clearances={clearances}
    />
  );
}
