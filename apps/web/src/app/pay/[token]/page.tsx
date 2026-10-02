import { notFound } from "next/navigation";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe-client";
import { completeCheckoutSetup } from "@/lib/autopay";
import { getPayPage, isPayToken } from "@/lib/queries/pay-page";
import { PayPage } from "@/components/pay-page";

// What is owed changes the moment anything is paid; never serve a cached copy.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Payments — Rising Stars",
  // A family's payment page should never turn up in a search result.
  robots: { index: false, follow: false },
};

export default async function PayTokenPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { setup?: string };
}) {
  if (!isPayToken(params.token)) notFound();

  // Back from Stripe Checkout. Saved here rather than left to the webhook, so
  // the page the parent lands on already says it worked.
  let justSetUp = false;
  if (searchParams.setup?.startsWith("cs_")) {
    const first = await getPayPage(params.token);
    const stripe = await getStripeClient();
    if (first && stripe) {
      try {
        await completeCheckoutSetup(createAdminSupabase(), stripe, searchParams.setup, first.parent.id);
        justSetUp = true;
      } catch {
        // The webhook will finish it; the page shows whatever state is saved.
      }
    }
  }

  const data = await getPayPage(params.token);
  if (!data) notFound();

  return <PayPage token={params.token} data={data} justSetUp={justSetUp} />;
}
