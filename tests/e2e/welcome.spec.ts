import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { LOCAL } from "../helpers/db";

/** An invite link: choose a password, land on the dashboard. A used link says so. */

test("an invited person chooses a password and is in", async ({ page }) => {
  const authAdmin = createClient(LOCAL.url, LOCAL.serviceKey, { auth: { persistSession: false } });
  const email = `invitee-${Date.now()}@example.test`;
  const { data } = await authAdmin.auth.admin.generateLink({ type: "invite", email });
  await authAdmin.auth.admin.updateUserById(data.user!.id, {
    app_metadata: { role: "admin" },
    user_metadata: { tour_completed_at: "2026-01-01T00:00:00Z" },
  });
  const link = `/welcome?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=invite`;

  await page.goto(link);
  await expect(page.getByRole("heading", { name: /Welcome to the team/ })).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("a-good-long-password");
  await page.getByLabel("Same password again").fill("a-good-long-password");
  await page.getByRole("button", { name: "Let's go" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // The same link again, signed out: used up.
  await page.context().clearCookies();
  await page.goto(link);
  await expect(page.getByTestId("welcome-bad")).toBeVisible();
  await authAdmin.auth.admin.deleteUser(data.user!.id);
});
