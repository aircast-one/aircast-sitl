import { test, expect } from "@playwright/test";

test.describe("Camera Page", () => {
  test("renders a bare 720p canvas with no HUD or controls", async ({ page }) => {
    await page.goto("/camera");
    const canvas = page.locator(".cesium-widget canvas");
    await expect(canvas).toBeVisible();

    const size = await canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
    expect(size).toEqual([1280, 720]);

    await expect(page.getByText("Roll")).toHaveCount(0);
    await expect(page.getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("link")).toHaveCount(0);
  });
});
