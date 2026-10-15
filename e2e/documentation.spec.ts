import { expect, test } from "@playwright/test";
import { waitReady } from "./helpers";

test("the Documentation tab explains how to use the workbench", async ({ page }) => {
  await page.goto("/?providers=fake");
  await waitReady(page);
  await page.getByRole("tab", { name: "Documentation" }).click();
  await expect(page.locator("#panel-workbench")).toBeHidden();
  const doc = page.locator("#panel-documentation");
  await expect(doc).toBeVisible();
  for (const heading of ["Before you start", "Interpret a conversation", "Read the measurements", "Compare Realtime and Cascade", "Run a test run", "When something goes wrong", "Terms"]) {
    await expect(doc.getByRole("heading", { name: heading })).toBeVisible();
  }
  // The open tab survives a reload.
  await page.reload();
  await expect(page.locator("#panel-documentation")).toBeVisible();
});
