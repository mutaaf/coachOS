import { describe, it, expect, afterEach } from "vitest";
import { admin, availability, register, seedProgram, truncateAll } from "../helpers/db";

afterEach(truncateAll);

describe("seat capacity", () => {
  it("confirms registrations up to capacity", async () => {
    const { programId } = await seedProgram({ capacity: 3 });

    for (const name of ["Amina", "Bilal", "Zayd"]) {
      const { data, error } = await register(programId, name);
      expect(error).toBeNull();
      expect(data.status).toBe("confirmed");
      expect(data.waitlist_position).toBeNull();
    }

    const seats = await availability(programId);
    expect(seats.seats_taken).toBe(3);
    expect(seats.seats_remaining).toBe(0);
  });

  it("waitlists the first registration past capacity", async () => {
    const { programId } = await seedProgram({ capacity: 1 });

    await register(programId, "First");
    const { data } = await register(programId, "Second");

    expect(data.status).toBe("waitlisted");
    expect(data.waitlist_position).toBe(1);
  });

  it("numbers the waitlist sequentially", async () => {
    const { programId } = await seedProgram({ capacity: 1 });
    await register(programId, "Seated");

    const positions: number[] = [];
    for (const name of ["A", "B", "C"]) {
      const { data } = await register(programId, name);
      positions.push(data.waitlist_position);
    }

    expect(positions).toEqual([1, 2, 3]);
  });

  it("defaults a new program to twelve seats", async () => {
    // Twelve is the rule the business actually runs on, so it is the default
    // rather than something that has to be set correctly every time.
    const { data, error } = await admin
      .from("programs")
      .insert({
        school_id: (await seedProgram({})).schoolId,
        name: "Program without an explicit capacity",
        monthly_fee: 150,
        status: "active",
      })
      .select("capacity")
      .single();

    expect(error).toBeNull();
    expect(data!.capacity).toBe(12);
  });

  it("refuses registrations when the program is closed", async () => {
    const { programId } = await seedProgram({ capacity: 5, registrationOpen: false });

    const { error } = await register(programId, "TooEarly");

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/registration is closed/i);
  });

  it("carries the program fee onto the registration", async () => {
    const { programId } = await seedProgram({ capacity: 2, monthlyFee: 175 });

    const { data } = await register(programId, "Fee");

    expect(Number(data.amount)).toBe(175);
  });
});

describe("concurrent registrations", () => {
  /**
   * The reason submit_registration locks the program row. Without it, parallel
   * submissions all read the same seat count and every one of them is confirmed,
   * which is exactly how a twelve-child session ends up with fifteen children.
   */
  it("never oversells the cap when submissions race", async () => {
    const capacity = 4;
    const { programId } = await seedProgram({ capacity });

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => register(programId, `Racer${i}`))
    );

    const statuses = results.map((r) => r.data.status);
    const confirmed = statuses.filter((s) => s === "confirmed").length;
    const waitlisted = statuses.filter((s) => s === "waitlisted").length;

    expect(confirmed).toBe(capacity);
    expect(waitlisted).toBe(20 - capacity);

    const seats = await availability(programId);
    expect(seats.seats_taken).toBe(capacity);
    expect(seats.seats_remaining).toBe(0);
  });

  it("assigns every racer a distinct waitlist position", async () => {
    const { programId } = await seedProgram({ capacity: 1 });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => register(programId, `Racer${i}`))
    );

    const positions = results
      .map((r) => r.data.waitlist_position)
      .filter((p): p is number => p !== null)
      .sort((a, b) => a - b);

    expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
