import { test, expect } from "@playwright/test";

test.describe("Dashboard Page", () => {
  test("renders title, subtitle, and footer", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Aircast SITL" }),
    ).toBeVisible();
    await expect(
      page.getByText("ArduPilot Software-in-the-Loop Simulator"),
    ).toBeVisible();
    await expect(
      page.getByText("Multi-Architecture ArduPilot Simulator"),
    ).toBeVisible();
  });

  test("shows connection status that updates when connected", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText(/SITL Status:/)).toBeVisible();
    await expect(
      page.getByText("SITL Status: Connected"),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("ArduCopter SITL is active and ready for connections"),
    ).toBeVisible();
  });

  test("displays connection cards with command snippets", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "MAVProxy" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "QGroundControl" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Mission Planner" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Python MAVLink" }),
    ).toBeVisible();
    await expect(
      page.getByText("mavproxy.py --master=tcp://sitl.aircast.one:5760"),
    ).toBeVisible();
  });

  test("connection card copies text to clipboard on click", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");

    await page
      .getByRole("heading", { name: "MAVProxy" })
      .locator("..")
      .click();

    const clipboardText = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(clipboardText).toContain("mavproxy.py");
  });

  test("FPV card navigates to FPV page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("3D FPV View")).toBeVisible();
    await expect(page.getByText("live MAVLink telemetry overlay")).toBeVisible();
    await page.getByText("3D FPV View").click();
    await expect(page).toHaveURL(/\/fpv/);
    await expect(page.locator("canvas")).toBeVisible();
  });

  test("shows available ports", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Available Ports" }),
    ).toBeVisible();
    await expect(page.getByText("TCP: 5760-5765")).toBeVisible();
    await expect(page.getByText("UDP: 14550-14555")).toBeVisible();
    await expect(page.getByText("FlightGear: 9005")).toBeVisible();
  });
});
