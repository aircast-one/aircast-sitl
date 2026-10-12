import { test, expect } from "@playwright/test";

test.describe("Dashboard Page", () => {
  test("renders the top bar and the operator panels", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Aircast SITL" })).toBeVisible();
    for (const panel of ["Airframe", "Telemetry", "Connect", "Views"]) {
      await expect(page.getByRole("heading", { name: panel, exact: true })).toBeVisible();
    }
  });

  test("the link light goes live once the SITL sends heartbeats", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText("Live", { timeout: 15_000 });
    await expect(page.getByText(/mode$/)).toBeVisible();
  });

  test("endpoints follow the page's host and copy on click", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    const host = await page.evaluate(() => location.hostname);
    await expect(page.getByText(`${host}:5760`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${host}:14550`, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Copy MAVProxy" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`mavproxy.py --master=tcp:${host}:5760`);
  });

  test("the 3D view link opens the FPV page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "3D view" }).click();
    await expect(page).toHaveURL(/\/fpv/);
    await expect(page.locator("canvas")).toBeVisible();
  });

  test("the vehicle picker restarts the SITL as a plane and back as a copter", async ({ page, request }) => {
    test.setTimeout(60_000);
    await request.post("/api/vehicle", { data: { vehicle: "copter" } });
    await page.goto("/");
    const picker = page.getByRole("group", { name: "Vehicle" });
    const copter = picker.getByRole("button", { name: "Copter" });
    const plane = picker.getByRole("button", { name: "Plane", exact: true });

    await expect(copter).toHaveAttribute("aria-pressed", "true");
    await plane.click();
    await expect(plane).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    await expect(page.getByRole("status")).toHaveText("Live", { timeout: 20_000 });
    expect(await (await request.get("/api/vehicle")).json()).toMatchObject({ vehicle: "plane" });

    await copter.click();
    await expect(copter).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    expect(await (await request.get("/api/vehicle")).json()).toMatchObject({ vehicle: "copter" });
  });

  test("lists the ports the simulator exposes", async ({ page }) => {
    await page.goto("/");
    for (const port of ["TCP 5760", "UDP 14550", "FlightGear 9005"]) {
      await expect(page.getByText(port, { exact: true })).toBeVisible();
    }
  });
});
