"use client";

import { CameraOff, Camera, Check, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAction } from "@/lib/use-action";
import { recordMarketingEmailChoice, recordSmsChoice, recordSmsPromotionalChoice, setPhotoRelease } from "@/lib/actions/consents";
import { formatBusinessTime } from "@/lib/dates";
import type { FamilyChild } from "@/lib/queries/families";
import type { Parent } from "@/types/database";

type Choice = "yes" | "no" | "none";

function choice(consentAt?: string | null, optOutAt?: string | null): Choice {
  if (optOutAt && (!consentAt || optOutAt >= consentAt)) return "no";
  if (consentAt) return "yes";
  return "none";
}

function Mark({ value, yes, no, none }: { value: Choice | boolean | null | undefined; yes: string; no: string; none: string }) {
  if (value === "yes" || value === true)
    return (
      <span className="inline-flex items-center gap-1 text-green-700">
        <Check className="h-3.5 w-3.5" /> {yes}
      </span>
    );
  if (value === "no" || value === false)
    return (
      <span className="inline-flex items-center gap-1 text-red-700">
        <X className="h-3.5 w-3.5" /> {no}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <Minus className="h-3.5 w-3.5" /> {none}
    </span>
  );
}

/**
 * What this family agreed to, and the buttons to record a change she hears
 * about directly (a STOP texted to her phone, a parent asking her not to post
 * photos). Texts that are only about the child's program go to every enrolled
 * family who hasn't said STOP; promotional texts only to "Promotional texts:
 * agreed" — program-text consent doesn't cover them. Newsletters only to
 * "Newsletter: yes".
 */
export function FamilyConsents({
  parentId,
  guardians,
  childrenOnFile,
}: {
  parentId: string;
  guardians: (Parent & { relationship: string })[];
  childrenOnFile: FamilyChild[];
}) {
  const { run, pending } = useAction();

  return (
    <section data-testid="family-consents" className="rounded-2xl border bg-card p-5">
      <h2 className="font-semibold">Consents</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        What this family agreed to. Record a change here as soon as you hear it — a STOP texted to your phone counts.
      </p>

      <ul className="space-y-3">
        {guardians.map((g) => {
          const sms = choice(g.sms_consent_at, g.sms_opt_out_at);
          // A STOP covers promotions too, whatever was agreed before it.
          const promo: Choice =
            sms === "no" ? "no" : choice(g.sms_promotional_consent_at, g.sms_promotional_opt_out_at);
          const news = choice(g.marketing_email_consent_at, g.marketing_email_opt_out_at);
          return (
            <li key={g.id} className="rounded-xl border p-3 text-sm">
              <p className="font-medium">
                {g.first_name} {g.last_name}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                <span data-testid="consent-sms">
                  Texts: <Mark value={sms} yes="OK to texts" no="Said STOP" none="No consent on file" />
                </span>
                <span data-testid="consent-sms-promotional">
                  Promotional texts:{" "}
                  <Mark value={promo} yes="Agreed" no="No promotions" none="Hasn't agreed — no promotions" />
                </span>
                <span data-testid="consent-marketing">
                  Newsletter: <Mark value={news} yes="Yes" no="Unsubscribed" none="Not opted in" />
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:flex">
                {sms === "no" ? (
                  <Button size="sm" variant="outline" className="h-11 sm:h-9" disabled={pending}
                    onClick={() => run(() => recordSmsChoice(g.id, true), { success: "Texts back on", error: "Not saved" })}>
                    They opted back in to texts
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="h-11 sm:h-9" disabled={pending}
                    onClick={() => run(() => recordSmsChoice(g.id, false), { success: "All texts stopped for this parent, promotions included", error: "Not saved" })}>
                    They said STOP
                  </Button>
                )}
                {sms !== "no" &&
                  (promo === "yes" ? (
                    <Button size="sm" variant="outline" className="h-11 sm:h-9" disabled={pending}
                      onClick={() => run(() => recordSmsPromotionalChoice(g.id, false), { success: "No more promotional texts for this parent", error: "Not saved" })}>
                      No more promotions
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="h-11 sm:h-9" disabled={pending}
                      title="Only when they agreed in writing (a signed form, or a text or email saying yes to offers and new programs)."
                      onClick={() => run(() => recordSmsPromotionalChoice(g.id, true), { success: "Promotional texts agreed", error: "Not saved" })}>
                      They agreed in writing to promotional texts
                    </Button>
                  ))}
                {news !== "no" && g.email && (
                  <Button size="sm" variant="outline" className="h-11 sm:h-9" disabled={pending}
                    onClick={() => run(() => recordMarketingEmailChoice(g.id, false), { success: "Unsubscribed", error: "Not saved" })}>
                    Unsubscribe from newsletter
                  </Button>
                )}
              </div>
            </li>
          );
        })}

        {childrenOnFile.map((c) => {
          const docs = c.consents?.documents && typeof c.consents.documents === "object" ? c.consents.documents : null;
          return (
            <li key={c.id} className="rounded-xl border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2 font-medium">
                {c.first_name} {c.last_name}
                {c.photo_release === true ? (
                  <Badge variant="success"><Camera className="mr-1 h-3 w-3" /> Photos OK</Badge>
                ) : (
                  <Badge variant="destructive" data-testid="no-photo-release"><CameraOff className="mr-1 h-3 w-3" /> Don&apos;t post photos</Badge>
                )}
              </div>
              {c.consents ? (
                <>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    <span>Terms: <Mark value={c.consents.terms} yes="Accepted" no="No" none="—" /></span>
                    <span>Medical care: <Mark value={c.consents.medical ?? null} yes="Agreed" no="Not agreed" none="Not asked" /></span>
                    <span>Photos: <Mark value={c.consents.photo ?? null} yes="Agreed" no="Not agreed" none="Not asked" /></span>
                    <span>Texts: <Mark value={c.consents.sms ?? null} yes="Agreed" no="Not agreed" none="Not asked" /></span>
                    <span>Promotional texts: <Mark value={c.consents.sms_promotional ?? null} yes="Agreed" no="Not agreed" none="Not asked" /></span>
                    <span>Newsletter: <Mark value={c.consents.marketing_email ?? null} yes="Agreed" no="Not agreed" none="Not asked" /></span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    On the website, {formatBusinessTime(c.consents.accepted_at)}
                    {c.consents.policy_version ? ` · policy ${c.consents.policy_version}` : ""}
                    {docs &&
                      " · " +
                        Object.entries(docs)
                          .map(([k, v]) => `${k.replace(/_/g, " ")} ${String(v)}`)
                          .join(", ")}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-muted-foreground">No website registration on file — no signed consents.</p>
              )}
              <div className="mt-2">
                {c.photo_release === true ? (
                  <Button size="sm" variant="outline" className="h-11 sm:h-9" disabled={pending}
                    onClick={() => run(() => setPhotoRelease(c.id, false, parentId), { success: "Photo release withdrawn", error: "Not saved" })}>
                    Withdraw photo release
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="h-11 sm:h-9" disabled={pending}
                    onClick={() => run(() => setPhotoRelease(c.id, true, parentId), { success: "Photo release recorded", error: "Not saved" })}>
                    Parent signed a photo release
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
