import { getRegistrations, getProgramAvailability } from "@/lib/queries/registrations";
import { RegistrationsPageClient } from "@/components/registrations-page-client";

// Seat counts move as parents register; always read them fresh.
export const dynamic = "force-dynamic";

export default async function RegistrationsPage() {
  const [registrations, availability] = await Promise.all([
    getRegistrations(),
    getProgramAvailability(),
  ]);

  return (
    <RegistrationsPageClient registrations={registrations} availability={availability} />
  );
}
