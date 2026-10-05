"use server";

import { revalidatePath } from "next/cache";
import { signedIn, NOT_SIGNED_IN, currentUser } from "@/lib/auth-guard";
import { createAdminSupabase } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import type { IncidentKind } from "@/types/database";

/**
 * Incident reports, admin only. Written at the time, kept as long as a claim
 * could be brought (see 20261006000150_incidents.sql). Every change is audited.
 */

const KINDS: IncidentKind[] = ["injury", "illness", "behavior", "safeguarding", "other"];
const UUID = /^[0-9a-f-]{36}$/i;

const text = (fd: FormData, name: string, max = 5000) => {
  const v = ((fd.get(name) as string) || "").trim();
  return v ? v.slice(0, max) : null;
};
const id = (fd: FormData, name: string) => {
  const v = ((fd.get(name) as string) || "").trim();
  return UUID.test(v) ? v : null;
};
/** A datetime-local value (Dallas time) or an ISO string, as an instant. */
const when = (fd: FormData, name: string) => {
  const v = ((fd.get(name) as string) || "").trim();
  if (!v) return null;
  // datetime-local has no zone; it is entered in Dallas.
  const withZone = /[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}${dallasOffset(v)}`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

function dallasOffset(local: string): string {
  // Central time: -05:00 in daylight time, -06:00 otherwise.
  const probe = new Date(`${local.slice(0, 10)}T12:00:00Z`);
  const tz = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "shortOffset" })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /GMT([+-]\d+)/.exec(tz ?? "");
  const hours = m ? Number(m[1]) : -6;
  return `${hours < 0 ? "-" : "+"}${String(Math.abs(hours)).padStart(2, "0")}:00`;
}

function readIncident(fd: FormData) {
  const kind = (fd.get("kind") as string) || "injury";
  return {
    occurred_at: when(fd, "occurred_at"),
    kind: (KINDS.includes(kind as IncidentKind) ? kind : "other") as IncidentKind,
    program_id: id(fd, "program_id"),
    session_id: id(fd, "session_id"),
    student_id: id(fd, "student_id"),
    coach_id: id(fd, "coach_id"),
    description: text(fd, "description"),
    actions_taken: text(fd, "actions_taken"),
    parent_notified_at: when(fd, "parent_notified_at"),
    parent_notified_how: text(fd, "parent_notified_how", 200),
    concussion_suspected: fd.get("concussion_suspected") === "on",
    reported_to_authorities_at: when(fd, "reported_to_authorities_at"),
    authority_reference: text(fd, "authority_reference", 200),
  };
}

function check(f: ReturnType<typeof readIncident>): string | null {
  if (!f.occurred_at) return "When did it happen?";
  if (f.occurred_at === undefined || f.parent_notified_at === undefined || f.reported_to_authorities_at === undefined) {
    return "Please check the dates and times.";
  }
  if (!f.description) return "Describe what happened.";
  if (f.concussion_suspected && !f.student_id) return "A suspected concussion needs the child it happened to.";
  return null;
}

export async function createIncident(formData: FormData) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const fields = readIncident(formData);
  const problem = check(fields);
  if (problem) return { error: problem };
  const user = await currentUser();
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("incidents")
    .insert({ ...fields, created_by: user?.id ?? null })
    .select("id")
    .single();
  if (error) return { error: error.message };
  await audit(supabase, {
    action: "incident.create",
    entity: "incident",
    entityId: data.id,
    detail: { kind: fields.kind, concussion_suspected: fields.concussion_suspected },
  });
  revalidatePath("/compliance");
  return { success: true, id: data.id as string };
}

export async function updateIncident(incidentId: string, formData: FormData) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const fields = readIncident(formData);
  const problem = check(fields);
  if (problem) return { error: problem };
  const supabase = createAdminSupabase();
  const { error } = await supabase.from("incidents").update(fields).eq("id", incidentId);
  if (error) return { error: error.message };
  await audit(supabase, { action: "incident.update", entity: "incident", entityId: incidentId });
  revalidatePath("/compliance");
  return { success: true };
}

/**
 * Written clearance to return to play, from a licensed health care
 * professional. Until this is recorded the child can't be marked present.
 */
export async function recordReturnToPlay(incidentId: string, formData: FormData) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const provider = text(formData, "clearance_provider", 200);
  const clearedAt = when(formData, "cleared_to_return_at") ?? new Date().toISOString();
  if (!provider) return { error: "Who signed the clearance? Name the doctor or licensed provider." };
  if (clearedAt === undefined) return { error: "Please check the date." };
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from("incidents")
    .update({ cleared_to_return_at: clearedAt, clearance_provider: provider, clearance_note: text(formData, "clearance_note") })
    .eq("id", incidentId);
  if (error) return { error: error.message };
  await audit(supabase, { action: "incident.return_to_play", entity: "incident", entityId: incidentId });
  revalidatePath("/compliance");
  revalidatePath("/schedule");
  return { success: true };
}

export async function setIncidentStatus(incidentId: string, status: "open" | "closed") {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  if (status !== "open" && status !== "closed") return { error: "Unknown status." };
  const supabase = createAdminSupabase();
  const { error } = await supabase.from("incidents").update({ status }).eq("id", incidentId);
  if (error) return { error: error.message };
  await audit(supabase, { action: `incident.${status === "closed" ? "close" : "reopen"}`, entity: "incident", entityId: incidentId });
  revalidatePath("/compliance");
  return { success: true };
}
