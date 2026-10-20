import { test, expect } from "@playwright/test";
import { readParam } from "./param.ts";

test.describe("Dashboard Page", () => {
  test("renders the top bar and the operator panels", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Aircast SITL" })).toBeVisible();
    for (const panel of ["Airframe", "Location", "Parameters", "Telemetry", "Connect", "Views"]) {
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

  test("the WebSocket address carries raw MAVLink for the browser app", async ({ page }) => {
    await page.goto("/");
    const host = await page.evaluate(() => location.hostname);
    const address = `ws://${host}:8889/ws/mavlink`;
    await expect(page.getByText(address, { exact: true })).toBeVisible();

    const firstByte = await page.evaluate(
      (url) =>
        new Promise<number>((resolve, reject) => {
          const socket = new WebSocket(url);
          socket.binaryType = "arraybuffer";
          socket.onmessage = ({ data }) => {
            socket.close();
            resolve(new Uint8Array(data as ArrayBuffer)[0]);
          };
          socket.onerror = () => reject(new Error(`No WebSocket at ${url}`));
        }),
      address,
    );
    expect(firstByte).toBe(0xfd);
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

  test("the location picker restarts the SITL where the map was clicked or coordinates were pasted", async ({ page, request }) => {
    test.setTimeout(90_000);
    const canberra = { lat: -35.363261, lng: 149.16523 };
    await request.post("/api/home", { data: canberra });
    await page.goto("/");
    const location = page.locator("section", { has: page.getByRole("heading", { name: "Location", exact: true }) });
    const coordinates = location.getByRole("textbox", { name: "Coordinates" });
    const move = location.getByRole("button", { name: "Move here" });

    await expect(coordinates).toHaveValue("-35.363261, 149.165230");
    await expect(move).toBeDisabled();
    await location.locator("canvas").click({ position: { x: 40, y: 40 } });
    await expect(coordinates).not.toHaveValue("-35.363261, 149.165230");
    await expect(move).toBeEnabled();

    await coordinates.fill("41.7151, 44.8271");
    await move.click();
    await expect(move).toBeDisabled({ timeout: 20_000 });
    await expect(location.getByText(/m AMSL$/)).toHaveText("590 m AMSL");
    await expect(page.getByText(/^LAT 41\.71/)).toBeVisible({ timeout: 30_000 });
    expect(await (await request.get("/api/home")).json()).toMatchObject({ lat: 41.7151, lng: 44.8271 });

    await request.post("/api/home", { data: canberra });
    await expect(page.getByText(/^LAT -35\.36/)).toBeVisible({ timeout: 30_000 });
  });

  test("the location API rejects coordinates off the globe", async ({ request }) => {
    const res = await request.post("/api/home", { data: { lat: 91, lng: 0 } });
    expect(res.status()).toBe(400);
  });

  test("parameters set on the dashboard reach the autopilot when the SITL restarts", async ({ page, request }) => {
    test.setTimeout(120_000);
    await request.post("/api/params", { data: { params: {} } });
    await page.goto("/");
    const panel = page.locator("section", { has: page.getByRole("heading", { name: "Parameters", exact: true }) });
    const editor = panel.getByRole("textbox", { name: "Parameters" });
    const apply = panel.getByRole("button", { name: "Apply" });

    await expect(panel.getByText("0 set")).toBeVisible();
    await expect(apply).toBeDisabled();
    await editor.fill("SIM_WIND_SPD 7\n# from the west\nsim_wind_dir, 270");
    await apply.click();
    await expect(panel.getByText("2 set")).toBeVisible({ timeout: 20_000 });
    expect(await (await request.get("/api/params")).json()).toEqual({ params: { SIM_WIND_SPD: 7, SIM_WIND_DIR: 270 } });
    expect(await readParam("SIM_WIND_SPD")).toBe(7);
    expect(await readParam("SIM_WIND_DIR")).toBe(270);

    await request.post("/api/params", { data: { params: {} } });
    expect(await readParam("SIM_WIND_SPD")).toBe(0);
  });

  test("the parameters API rejects what ArduPilot would not load", async ({ request }) => {
    const rejected = [{ SIM_WIND_SPD: "7" }, { "sim wind": 7 }, { SIM_WIND_SPD_TOO_LONG: 7 }, { SIM_WIND_SPD: true }];
    const statuses = await Promise.all(rejected.map(async (params) => (await request.post("/api/params", { data: { params } })).status()));
    expect(statuses).toEqual(rejected.map(() => 400));
  });

  test("lists the ports the simulator exposes", async ({ page }) => {
    await page.goto("/");
    for (const port of ["TCP 5760", "UDP 14550", "FlightGear 9005"]) {
      await expect(page.getByText(port, { exact: true })).toBeVisible();
    }
  });
});
