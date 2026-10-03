import { describe, it, expect, afterEach } from "vitest";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { normalizePhone } from "@/lib/roster";
import { toWhatsAppDigits } from "@/lib/outbox";
import { matchesPhone } from "@/lib/identity";
import { createParent, updateParent } from "@/lib/actions/students";
import { createCoach, updateCoach } from "@/lib/actions/coaches";
import { submitRegistration } from "@/lib/actions/registrations";
import { bulkCreateParents } from "@/lib/actions/bulk-import";

/**
 * Phones are saved as one number, not as typed (issue #22). "214.555.1000"
 * stored verbatim became wa.me/2145551000 on the Registrations and Coaches
 * pages — no 1, so WhatsApp dialled another country — and "12" or
 * "214.555.1000 call after 5" were accepted as phone numbers.
 */

afterEach(truncateAll);

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const BAD = ["12", "214.555.1000 call after 5", "call me"];

describe("a parent's phone", () => {
  it("is saved as one number however it was typed", async () => {
    const r = (await createParent(form({ first_name: "Raquel", last_name: "Garcia", phone: "214.555.1000" }))) as any;
    expect(r.error).toBeUndefined();
    expect(r.data.phone).toBe("+12145551000");

    const u = (await updateParent(r.data.id, form({ first_name: "Raquel", last_name: "Garcia", phone: "(972) 891-8266" }))) as any;
    expect(u.data.phone).toBe("+19728918266");
  });

  it("is refused when it isn't a phone number", async () => {
    for (const phone of BAD) {
      const r = (await createParent(form({ first_name: "Raquel", last_name: "Garcia", phone }))) as any;
      expect(r.error, phone).toMatch(/phone number/i);
    }
    const { count } = await admin.from("parents").select("*", { count: "exact", head: true });
    expect(count).toBe(0);

    const { data: p } = await admin
      .from("parents")
      .insert({ first_name: "Raquel", last_name: "Garcia", phone: "+12145551000" })
      .select("id")
      .single();
    const u = (await updateParent(p!.id, form({ first_name: "Raquel", last_name: "Garcia", phone: "12" }))) as any;
    expect(u.error).toMatch(/phone number/i);
    const { data: after } = await admin.from("parents").select("phone").eq("id", p!.id).single();
    expect(after!.phone).toBe("+12145551000");
  });

  it("is normalised in Bulk Parents, and a bad one is reported rather than saved", async () => {
    const r = await bulkCreateParents([
      { first_name: "Raquel", last_name: "Garcia", phone: "214.555.1000" },
      { first_name: "Star", last_name: "Okafor", phone: "12" },
    ]);
    expect(r.created).toBe(1);
    expect(r.errors).toEqual([{ row: 1, message: expect.stringMatching(/phone number/i) }]);
    const { data } = await admin.from("parents").select("phone");
    expect(data).toEqual([{ phone: "+12145551000" }]);
  });
});

describe("a coach's phone", () => {
  const coach = (phone: string) =>
    form({ first_name: "Ahmed", last_name: "Rahman", phone, pay_type: "per_session", status: "active" });

  it("is saved as one number, and refused when it isn't one", async () => {
    expect((await createCoach(coach("214.555.1000"))).error).toBeUndefined();
    const { data } = await admin.from("coaches").select("id, phone").single();
    expect(data!.phone).toBe("+12145551000");

    for (const phone of BAD) {
      expect((await createCoach(coach(phone))).error, phone).toMatch(/phone number/i);
      expect((await updateCoach(data!.id, coach(phone))).error, phone).toMatch(/phone number/i);
    }
    expect((await updateCoach(data!.id, coach("972 891 8266"))).error).toBeUndefined();
    const { data: after } = await admin.from("coaches").select("phone");
    expect(after).toEqual([{ phone: "+19728918266" }]);
  });
});

describe("a registration's phone, from the public /join page", () => {
  const signUp = (programId: string, parent_phone: string) =>
    submitRegistration(
      form({
        program_id: programId,
        child_first_name: "Mia",
        child_last_name: "Garcia",
        parent_first_name: "Raquel",
        parent_last_name: "Garcia",
        parent_phone,
      })
    );

  it("is saved as one number, and the family is asked again when it isn't one", async () => {
    const { programId } = await seedProgram();
    for (const phone of BAD) {
      expect(((await signUp(programId, phone)) as any).error, phone).toMatch(/phone number/i);
    }
    expect(((await signUp(programId, "214.555.1000")) as any).error).toBeUndefined();
    const { data } = await admin.from("registrations").select("parent_phone");
    expect(data).toEqual([{ parent_phone: "+12145551000" }]);
  });
});

describe("WhatsApp links", () => {
  it("dial the US number, with its 1, however it was saved", () => {
    for (const phone of ["214.555.1000", "(214) 555-1000", "+1 214 555 1000", "+12145551000"]) {
      expect(toWhatsAppDigits(phone), phone).toBe("12145551000");
    }
    expect(toWhatsAppDigits("+44 20 7946 0958")).toBe("442079460958");
    expect(toWhatsAppDigits("12")).toBeNull();
  });
});

describe("searching by phone", () => {
  it("finds the number whatever format either was typed in", () => {
    for (const q of ["214.555.1000", "(214) 555", "2145551000", "555-1000"]) {
      expect(matchesPhone("+12145551000", q), q).toBe(true);
    }
    expect(matchesPhone("+12145551000", "972")).toBe(false);
    // Not a phone search at all: names are searched elsewhere.
    expect(matchesPhone("+12145551000", "Raquel")).toBe(false);
    expect(matchesPhone("+12145551000", "")).toBe(false);
  });
});

describe("the numbers already on file", () => {
  it("are normalised by the database the same way the app does it", async () => {
    const inputs = [
      "214.555.1000",
      "(972) 891-8266",
      "+1 972 891 8266",
      "19728918266",
      "214-555-0101 x12",
      "214-555-0101 ext. 3",
      "+44 20 7946 0958",
      "214555010112",
      "12",
      "214.555.1000 call after 5",
      "",
    ];
    for (const raw of inputs) {
      const { data, error } = await admin.rpc("normalize_phone", { raw });
      expect(error).toBeNull();
      expect(data, raw).toBe(normalizePhone(raw));
    }
  });
});
