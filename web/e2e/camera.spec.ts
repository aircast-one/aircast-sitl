import { test, expect } from "@playwright/test";

test.describe("Camera Page", () => {
  test("renders a 720p view, supersampled 1.5x, with no HUD and a way back", async ({ page }) => {
    await page.goto("/camera");
    const canvas = page.locator(".cesium-widget canvas");
    await expect(canvas).toBeVisible();

    const size = await canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
    expect(size).toEqual([1920, 1080]);
    expect(await canvas.boundingBox()).toMatchObject({ width: 1280, height: 720 });

    await expect(page.getByText("Roll")).toHaveCount(0);
    await expect(page).toHaveTitle("FPV camera · Aircast SITL");
    await expect(page.getByText(/^FPV camera ·/)).toBeVisible();
    await expect(page.getByRole("link")).toHaveText(["SITL Dashboard"]);
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
    await expect(page).toHaveTitle("Payload camera · Aircast SITL");

    const criticalErrors = errors.filter(
      (e) => !e.includes("WebSocket") && !e.includes("ERR_CONNECTION") && !e.includes("401") && !e.includes("RequestErrorEvent"),
    );
    expect(criticalErrors).toEqual([]);
  });

  test("the dashboard opens each camera's live stream in a new tab and lists its RTSP address", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.getByRole("complementary");
    const cameras = [
      { name: "FPV camera", feed: "sim" },
      { name: "Payload camera", feed: "shoot" },
    ];
    await Promise.all(
      cameras.map(async ({ name, feed }) => {
        const live = sidebar.getByRole("link", { name: new RegExp(`^${name}`) });
        await expect(live).toHaveAttribute("href", `http://localhost:8890/${feed}/`);
        await expect(live).toHaveAttribute("target", "_blank");
        await expect(sidebar.getByText(`rtsp://localhost:8554/${feed}`, { exact: true })).toBeVisible();
      }),
    );
  });
});
