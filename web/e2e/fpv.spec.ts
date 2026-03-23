import { test, expect } from "@playwright/test";

test.describe("FPV Page", () => {
  test("renders Cesium 3D globe filling the viewport", async ({ page }) => {
    await page.goto("/fpv");
    await expect(page.locator(".cesium-widget")).toBeVisible();

    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();

    const viewport = page.viewportSize()!;
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBe(viewport.width);
    expect(box!.height).toBe(viewport.height);

    const hasScrollbar = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth >
          document.documentElement.clientWidth ||
        document.documentElement.scrollHeight >
          document.documentElement.clientHeight
      );
    });
    expect(hasScrollbar).toBe(false);
  });

  test("shows HUD with attitude, position, and GPS", async ({ page }) => {
    await page.goto("/fpv");
    // Attitude
    await expect(page.getByText("Roll")).toBeVisible();
    await expect(page.getByText("Pitch")).toBeVisible();
    await expect(page.getByText("Yaw")).toBeVisible();
    // Position
    await expect(page.getByText("Alt AGL")).toBeVisible();
    await expect(page.getByText("Speed")).toBeVisible();
    await expect(page.getByText("Heading")).toBeVisible();
    // GPS
    await expect(page.getByText("Lat")).toBeVisible();
    await expect(page.getByText("Lng")).toBeVisible();
    // Values render with units
    await expect(page.getByText(/\d+\.\d+ m$/).first()).toBeVisible();
    await expect(page.getByText(/\d+\.\d+ m\/s/)).toBeVisible();
    await expect(page.getByText(/\d+\.\d+°/).first()).toBeVisible();
  });

  test("shows connection status indicator", async ({ page }) => {
    await page.goto("/fpv");
    await expect(page.getByText(/Connected|Connecting/)).toBeVisible();
  });

  test("back link navigates to dashboard", async ({ page }) => {
    await page.goto("/fpv");
    const backLink = page.getByText("SITL Dashboard");
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("heading", { name: "Aircast SITL" }),
    ).toBeVisible();
  });

  test("receives telemetry and updates HUD values", async ({ page }) => {
    await page.goto("/fpv");

    await expect(
      page.getByText("Connected", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // SITL default location is near Canberra (-35.x, 149.x)
    await expect(page.getByText(/-35\.\d+/).first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(/149\.\d+/)).toBeVisible({
      timeout: 5_000,
    });
    // Heading updates with degree value
    await expect(
      page.getByText(/Heading/).locator("..").getByText(/\d+°/),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("no critical console errors on page load", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await page.goto("/fpv");
    await expect(page.locator(".cesium-widget")).toBeVisible();

    // Filter out known non-critical errors (Cesium Ion token, WebSocket before SITL ready)
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes("WebSocket") &&
        !e.includes("ERR_CONNECTION") &&
        !e.includes("401") &&
        !e.includes("RequestErrorEvent"),
    );
    expect(criticalErrors).toEqual([]);
  });
});
