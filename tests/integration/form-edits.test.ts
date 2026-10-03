import { describe, it, expect, afterEach } from "vitest";
import { admin, truncateAll } from "../helpers/db";
import { updateParent } from "@/lib/actions/students";
import { updateCoach } from "@/lib/actions/coaches";

/**
 * Issue #10: an edit form only saves what it shows. A save that leaves a field
 * out of the form must leave that field as it was, so fixing a phone number
 * can't switch a Zelle family to cash or an hourly coach to per-session.
 */

afterEach(truncateAll);

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("editing a parent", () => {
  async function zelleParent() {
    const { data } = await admin
      .from("parents")
      .insert({
        first_name: "Amina",
        last_name: "Khan",
        phone: "+12145550101",
        preferred_payment: "zelle",
        zelle_identifier: "amina@example.test",
        venmo_handle: "@amina",
      })
      .select("id")
      .single();
    return data!.id as string;
  }

  it("keeps how they pay when the form didn't include it", async () => {
    const id = await zelleParent();

    const result = await updateParent(
      id,
      form({ first_name: "Amina", last_name: "Khan", phone: "+12145550199", notes: "New number" })
    );
    expect(result.error).toBeUndefined();

    const { data } = await admin.from("parents").select("*").eq("id", id).single();
    expect(data).toMatchObject({
      phone: "+12145550199",
      notes: "New number",
      preferred_payment: "zelle",
      zelle_identifier: "amina@example.test",
      venmo_handle: "@amina",
    });
  });

  it("keeps the Zelle name on file when the method changes, so matching still works if it changes back", async () => {
    const id = await zelleParent();

    await updateParent(
      id,
      form({ first_name: "Amina", last_name: "Khan", phone: "+12145550101", preferred_payment: "cash" })
    );

    const { data } = await admin.from("parents").select("*").eq("id", id).single();
    expect(data).toMatchObject({ preferred_payment: "cash", zelle_identifier: "amina@example.test" });
  });

  it("clears a field the form showed empty", async () => {
    const id = await zelleParent();

    await updateParent(
      id,
      form({
        first_name: "Amina",
        last_name: "Khan",
        phone: "+12145550101",
        preferred_payment: "zelle",
        zelle_identifier: "",
      })
    );

    const { data } = await admin.from("parents").select("zelle_identifier").eq("id", id).single();
    expect(data!.zelle_identifier).toBeNull();
  });
});

describe("editing a coach", () => {
  it("keeps an hourly coach hourly when the form didn't include how they're paid", async () => {
    const { data: coach } = await admin
      .from("coaches")
      .insert({
        first_name: "Jose",
        last_name: "Diaz",
        phone: "+12145550202",
        pay_type: "hourly",
        pay_rate: 25,
        status: "active",
        source: "Referral",
      })
      .select("id")
      .single();

    const result = await updateCoach(
      coach!.id,
      form({ first_name: "Jose", last_name: "Diaz", phone: "+12145550203" })
    );
    expect(result.error).toBeUndefined();

    const { data } = await admin.from("coaches").select("*").eq("id", coach!.id).single();
    expect(data).toMatchObject({
      phone: "+12145550203",
      pay_type: "hourly",
      status: "active",
      source: "Referral",
    });
    expect(Number(data!.pay_rate)).toBe(25);
  });
});
