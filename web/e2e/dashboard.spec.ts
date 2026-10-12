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
      page.getByText(/SITL is active and ready for connections/),
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

  test("the vehicle picker restarts the SITL as a plane and back as a copter", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await request.post("/api/vehicle", { data: { vehicle: "copter" } });
    await page.goto("/");
    const picker = page.getByRole("group", { name: "Vehicle" });
    const copter = picker.getByRole("button", { name: "Copter" });
    const plane = picker.getByRole("button", { name: "Plane", exact: true });

    await expect(copter).toHaveAttribute("aria-pressed", "true");
    await plane.click();
    await expect(plane).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    await expect(
      page.getByText("ArduPlane SITL is active and ready for connections"),
    ).toBeVisible();
    expect(await (await request.get("/api/vehicle")).json()).toMatchObject({ vehicle: "plane" });

    await copter.click();
    await expect(copter).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    expect(await (await request.get("/api/vehicle")).json()).toMatchObject({ vehicle: "copter" });
  });

  test("shows available ports", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Available Ports" }),
    ).toBeVisible();
    await expect(page.getByText("TCP: 5760", { exact: true })).toBeVisible();
    await expect(page.getByText("UDP: 14550", { exact: true })).toBeVisible();
    await expect(page.getByText("FlightGear: 9005")).toBeVisible();
  });
});
