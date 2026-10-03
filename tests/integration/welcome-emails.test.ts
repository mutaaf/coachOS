import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { submitRegistration, convertRegistration } from "@/lib/actions/registrations";
import { createProgram, updateProgram } from "@/lib/actions/programs";
import { registrationEmail, welcomeEmail } from "@/lib/email-templates";
import { POST as notify } from "@/app/api/registrations/notify/route";
import { GET as cron } from "@/app/api/cron/daily-reminders/route";
import { NextRequest } from "next/server";

/**
 * Signing up should feel like a celebration — and only point a family at
 * WhatsApp when their program actually has a group. The group link goes only
 * to families with a place, never the waitlist, and never onto a public page.
 */

const GROUP = "https://chat.whatsapp.com/AbCdEf123456";
let saved: string | null = null;

beforeEach(async () => {
  const { data } = await admin.from("config").select("value").eq("key", "emails_enabled").single();
  saved = data!.value;
  await admin.from("config").update({ value: "true" }).eq("key", "emails_enabled");
});
afterEach(async () => {
  await admin.from("config").update({ value: saved }).eq("key", "emails_enabled");
  await truncateAll();
});
afterAll(truncateAll);

function form(programId: string, over: Record<string, string> = {}) {
  const f = new FormData();
  const fields = {
    program_id: programId,
    child_first_name: "Mia",
    child_last_name: "Garcia",
    parent_first_name: "Raquel",
    parent_last_name: "Garcia",
    parent_phone: "(214) 555-0150",
    parent_email: "raquel@example.com",
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function emails(kind: string) {
  const { data } = await admin.from("emails").select("kind, to_address, subject, body_text, dedupe_key").eq("kind", kind);
  return data!;
}

describe("signing up", () => {
  it("a place in a program with a group: celebrated, emailed once, and given the group", async () => {
    const { programId } = await seedProgram({ capacity: 5, monthlyFee: 100 });
    await admin.from("programs").update({ whatsapp_group_url: GROUP }).eq("id", programId);

    const result: any = await submitRegistration(form(programId));
    expect(result.error).toBeUndefined();
    expect(result.whatsappGroupUrl).toBe(GROUP);

    const [sent] = await emails("registration");
    expect(sent.to_address).toBe("raquel@example.com");
    expect(sent.subject).toBe("🎉 Mia is in! Welcome to " + (await admin.from("programs").select("name").eq("id", programId).single()).data!.name);
    expect(sent.body_text).toContain(GROUP);

    // The website's ping and the daily sweep ask again: still one email.
    const ping = await notify(new NextRequest("http://x/api/registrations/notify", {
      method: "POST",
      body: JSON.stringify({ program_id: programId, parent_phone: "2145550150", child_first_name: "mia" }),
    }));
    // The website gets the group link for the family who just signed up.
    expect(await ping.json()).toEqual({ ok: true, whatsappGroupUrl: GROUP });
    process.env.CRON_SECRET = "test-cron";
    const ran = await cron(new NextRequest("http://x/api/cron/daily-reminders", { headers: { authorization: "Bearer test-cron" } }));
    expect(ran.status).toBe(200);
    expect(await emails("registration")).toHaveLength(1);
  });

  it("no group: no WhatsApp anywhere", async () => {
    const { programId } = await seedProgram({ capacity: 5 });
    const result: any = await submitRegistration(form(programId));
    expect(result.whatsappGroupUrl).toBeNull();
    const [sent] = await emails("registration");
    expect(sent.body_text).not.toMatch(/whatsapp/i);
    expect(sent.body_text).toContain("We'll send updates by email and text.");
  });

  it("the waitlist doesn't get the group", async () => {
    const { programId } = await seedProgram({ capacity: 1 });
    await admin.from("programs").update({ whatsapp_group_url: GROUP }).eq("id", programId);
    await submitRegistration(form(programId, { child_first_name: "First", parent_phone: "2145550001", parent_email: "" }));
    const result: any = await submitRegistration(form(programId));
    expect(result.status).toBe("waitlisted");
    expect(result.whatsappGroupUrl).toBeNull();
    const [sent] = await emails("registration");
    expect(sent.subject).toMatch(/on the list/);
    expect(sent.body_text).not.toContain(GROUP);
  });

  it("the website's ping only acts on what was just registered, and says nothing back", async () => {
    const { programId } = await seedProgram({ capacity: 5 });
    // A registration from yesterday, never emailed.
    await admin.from("registrations").insert({
      program_id: programId, status: "confirmed", child_first_name: "Old", child_last_name: "X",
      parent_first_name: "P", parent_last_name: "X", parent_phone: "2145550999", parent_email: "old@example.com",
      created_at: new Date(Date.now() - 26 * 3600_000).toISOString(),
    });
    const res = await notify(new NextRequest("http://x", {
      method: "POST",
      body: JSON.stringify({ program_id: programId, parent_phone: "2145550999", child_first_name: "Old" }),
    }));
    expect(await res.json()).toEqual({ ok: true, whatsappGroupUrl: null });
    expect(await emails("registration")).toHaveLength(0);
  });
});

describe("on the roster", () => {
  it("converting a registration sends the welcome, with first practice, payment page and group", async () => {
    const { programId } = await seedProgram({ capacity: 5, monthlyFee: 120 });
    await admin.from("programs").update({ whatsapp_group_url: GROUP }).eq("id", programId);
    await submitRegistration(form(programId));
    const { data: reg } = await admin.from("registrations").select("id").single();

    expect((await convertRegistration(reg!.id)) as any).toMatchObject({ success: true });
    const [welcome] = await emails("welcome");
    expect(welcome.subject).toBe("Welcome to the team, Mia! ⭐");
    expect(welcome.body_text).toContain(GROUP);
    expect(welcome.body_text).toMatch(/\/pay\/[\w-]+/);
    expect(welcome.body_text).toContain("$120.00 a month");

    await convertRegistration(reg!.id);
    expect(await emails("welcome")).toHaveLength(1);
  });
});

describe("the group link on a program", () => {
  it("must be a WhatsApp group invite", async () => {
    const { schoolId, programId } = await seedProgram();
    const f = (url: string) => {
      const d = new FormData();
      d.set("school_id", schoolId);
      d.set("name", "Fall Soccer");
      d.set("monthly_fee", "100");
      d.set("status", "active");
      d.set("whatsapp_group_url", url);
      return d;
    };
    expect(((await updateProgram(programId, f("https://wa.me/12145550100"))) as any).error).toMatch(/WhatsApp group invite link/);
    expect(((await createProgram(f("https://example.com/chat.whatsapp.com/x"))) as any).error).toMatch(/WhatsApp group invite link/);
    expect(((await updateProgram(programId, f(GROUP))) as any).error).toBeUndefined();
    const { data } = await admin.from("programs").select("whatsapp_group_url").eq("id", programId).single();
    expect(data!.whatsapp_group_url).toBe(GROUP);
  });
});

describe("the emails themselves", () => {
  const program = {
    programName: "Lil Dribblers", schoolName: "Lakehill Elementary", schedule: "Tuesdays, 3:30–4:30 PM at Field B",
    firstPractice: "Tuesday, October 6", monthlyFeeCents: 10000,
  };
  it("are festive, and escape what parents typed", () => {
    const r = registrationEmail({ ...program, whatsappUrl: GROUP, brand: "Rising Stars", parentName: "<b>Raquel</b>", childName: "Mia", status: "confirmed", waitlistPosition: null });
    expect(r.html).toContain("/email/celebrate.gif");
    expect(r.html).toContain("Join the team group chat");
    expect(r.html).not.toContain("<b>Raquel</b>");
    expect(r.html).toContain("&lt;b&gt;Raquel&lt;/b&gt;");
    expect(r.text).toContain("First practice: Tuesday, October 6");

    const w = welcomeEmail({ ...program, whatsappUrl: null, brand: "Rising Stars", parentName: "Raquel", childName: "Mia", payLink: "https://x/pay/abc" });
    expect(w.html).not.toMatch(/whatsapp/i);
    expect(w.html).toContain("Game-day checklist");
  });
});

describe("the website's ping, abused", () => {
  it("a % in the name matches nothing", async () => {
    const { programId } = await seedProgram({ capacity: 5 });
    await admin.from("programs").update({ whatsapp_group_url: GROUP }).eq("id", programId);
    await submitRegistration(form(programId, { parent_email: "" }));
    const res = await notify(new NextRequest("http://x", {
      method: "POST",
      body: JSON.stringify({ program_id: programId, parent_phone: "2145550150", child_first_name: "%" }),
    }));
    expect(await res.json()).toEqual({ ok: true, whatsappGroupUrl: null });
  });
});

describe("practice times", () => {
  it("say AM and PM right when a practice crosses noon", async () => {
    const { scheduleText } = await import("@/lib/parent-emails");
    expect(scheduleText({ day_of_week: 6, start_time: "11:00", end_time: "12:00", location: null })).toBe("Saturdays, 11 AM–12 PM");
    expect(scheduleText({ day_of_week: 2, start_time: "15:30", end_time: "16:30", location: "Field B" })).toBe("Tuesdays, 3:30–4:30 PM at Field B");
  });
});
