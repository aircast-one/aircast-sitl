import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  test("dashboard to FPV and back preserves WebSocket connection", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByText("SITL Status: Connected"),
    ).toBeVisible({ timeout: 15_000 });

    // Navigate to FPV
    await page.getByText("3D FPV View").click();
    await expect(page).toHaveURL(/\/fpv/);
    await expect(page.locator("canvas")).toBeVisible();
    await expect(
      page.getByText("Connected", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Navigate back to dashboard
    await page.getByText("SITL Dashboard").click();
    await expect(page).toHaveURL("/");
    await expect(
      page.getByText("SITL Status: Connected"),
    ).toBeVisible({ timeout: 15_000 });
  });
});
