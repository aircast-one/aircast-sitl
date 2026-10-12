import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  test("dashboard to FPV and back keeps the telemetry live", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText("Live", { timeout: 15_000 });

    await page.getByRole("link", { name: /3D FPV view/ }).click();
    await expect(page).toHaveURL(/\/fpv/);
    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible({ timeout: 15_000 });

    await page.getByText("SITL Dashboard").click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("status")).toHaveText("Live", { timeout: 15_000 });
  });
});
