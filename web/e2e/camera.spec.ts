import { test, expect } from "@playwright/test";

test.describe("Camera Page", () => {
  test("renders a bare 720p view, supersampled 1.5x, with no HUD or controls", async ({ page }) => {
    await page.goto("/camera");
    const canvas = page.locator(".cesium-widget canvas");
    await expect(canvas).toBeVisible();

    const size = await canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
    expect(size).toEqual([1920, 1080]);
    expect(await canvas.boundingBox()).toMatchObject({ width: 1280, height: 720 });

    await expect(page.getByText("Roll")).toHaveCount(0);
    await expect(page.getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("link")).toHaveCount(0);
  });

  test("renders the payload gimbal's view with no critical errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/camera?gimbal=2");
    const canvas = page.locator(".cesium-widget canvas");
    await expect(canvas).toBeVisible();
    expect(await canvas.boundingBox()).toMatchObject({ width: 1280, height: 720 });

    const criticalErrors = errors.filter(
      (e) => !e.includes("WebSocket") && !e.includes("ERR_CONNECTION") && !e.includes("401") && !e.includes("RequestErrorEvent"),
    );
    expect(criticalErrors).toEqual([]);
  });
});
