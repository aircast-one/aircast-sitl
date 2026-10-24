import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
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
    await page.getByRole("link", { name: "3D view", exact: true }).click();
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

  test("place search tells apart places that share a name", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("searchbox", { name: "Enter an address or landmark..." }).fill("canbera");
    const suggestions = page.locator(".search-results li");
    await expect(suggestions.first()).toBeVisible({ timeout: 10_000 });
    const labels = await suggestions.allTextContents();
    expect(labels.length).toBeGreaterThan(1);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test.describe("Parameters", () => {
    const clear = async (request: APIRequestContext) => {
      const { params } = await (await request.get("/api/params")).json();
      if (Object.keys(params).length > 0) await request.post("/api/params", { data: { params: {} } });
    };
    const panelOf = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: "Parameters", exact: true }) });

    test.beforeEach(async ({ request }) => clear(request));
    test.afterEach(async ({ request }) => clear(request));

    test("the Gripper preset gives the drone a gripper and takes it away again", async ({ page }) => {
      test.setTimeout(120_000);
      await page.goto("/");
      const panel = panelOf(page);
      const gripper = panel.getByRole("button", { name: "Gripper" });
      const editor = panel.getByRole("textbox", { name: "Parameters" });
      const apply = panel.getByRole("button", { name: "Apply" });

      await expect(panel.getByText("0 set")).toBeVisible();
      await gripper.click();
      await expect(gripper).toHaveAttribute("aria-pressed", "true");
      await expect(editor).toHaveValue(/GRIP_ENABLE 1\nGRIP_TYPE 1\nSERVO12_FUNCTION 28\nGRIP_AUTOCLOSE 2$/);
      await apply.click();
      await expect(panel.getByText("Restarted with 4 parameters.")).toBeVisible({ timeout: 45_000 });
      expect(await readParam("GRIP_ENABLE")).toBe(1);
      expect(await readParam("SERVO12_FUNCTION")).toBe(28);

      await gripper.click();
      await expect(gripper).toHaveAttribute("aria-pressed", "false");
      await expect(editor).toHaveValue("");
      await apply.click();
      await expect(panel.getByText("Restarted with the airframe's own defaults.")).toBeVisible({ timeout: 45_000 });
      expect(await readParam("GRIP_ENABLE")).toBe(0);
    });

    test("every preset is a set the copter loads", async ({ page }) => {
      test.setTimeout(120_000);
      await page.goto("/");
      const panel = panelOf(page);
      const presets = panel.getByRole("group", { name: "Presets" }).getByRole("button");
      await expect(presets).toHaveCount(4);
      for (const preset of await presets.all()) await preset.click();
      await panel.getByRole("button", { name: "Apply" }).click();
      await expect(panel.getByText("Restarted with 14 parameters.")).toBeVisible({ timeout: 45_000 });
      expect(await readParam("SERVO13_FUNCTION")).toBe(7);
      expect(await readParam("SIM_WIND_DIR")).toBe(270);
      expect(await readParam("SIM_BATT_VOLTAGE")).toBeCloseTo(10.4, 5);
    });

    test("typed parameters reach the autopilot, comments and lowercase allowed", async ({ page, request }) => {
      test.setTimeout(120_000);
      await page.goto("/");
      const panel = panelOf(page);
      await panel.getByRole("textbox", { name: "Parameters" }).fill("SIM_WIND_SPD 7\n# from the west\nsim_wind_dir, 270");
      await panel.getByRole("button", { name: "Apply" }).click();
      await expect(panel.getByText("Restarted with 2 parameters.")).toBeVisible({ timeout: 45_000 });
      expect(await (await request.get("/api/params")).json()).toEqual({ params: { SIM_WIND_SPD: 7, SIM_WIND_DIR: 270 } });
      expect(await readParam("SIM_WIND_SPD")).toBe(7);
    });

    test("a malformed line is named and blocks Apply", async ({ page }) => {
      await page.goto("/");
      const panel = panelOf(page);
      const editor = panel.getByRole("textbox", { name: "Parameters" });
      const apply = panel.getByRole("button", { name: "Apply" });

      await editor.fill("GRIP_ENABLE 1\nGRIP_TYPE servo");
      await expect(panel.getByRole("alert")).toHaveText("Line 2: “servo” is not a number");
      await expect(apply).toBeDisabled();
      await editor.fill("GRIP_AUTOCLOSE_TIME 2");
      await expect(panel.getByRole("alert")).toHaveText("Line 1: GRIP_AUTOCLOSE_TIME is longer than 16 characters");
      await editor.fill("GRIP_ENABLE");
      await expect(panel.getByRole("alert")).toHaveText("Line 1: write it as NAME value");
    });

    test("a misspelled name is refused with a suggestion, without restarting", async ({ page, request }) => {
      await page.goto("/");
      const panel = panelOf(page);
      await panel.getByRole("textbox", { name: "Parameters" }).fill("GRIP_ENABLED 1");
      await panel.getByRole("button", { name: "Apply" }).click();
      await expect(panel.getByRole("alert")).toHaveText("GRIP_ENABLED (did you mean GRIP_ENABLE?) is not a copter parameter", { timeout: 30_000 });
      await expect(page.getByRole("status")).toHaveText("Live");
      expect(await (await request.get("/api/params")).json()).toEqual({ params: {} });

      const res = await request.post("/api/params", { data: { params: { GRIP_ENABLED: 1 } } });
      expect(res.status()).toBe(400);
      expect(await res.json()).toMatchObject({ unknown: { GRIP_ENABLED: "GRIP_ENABLE" } });
    });

    test("the API rejects what ArduPilot could not load", async ({ request }) => {
      const rejected = [{ SIM_WIND_SPD: "7" }, { "sim wind": 7 }, { SIM_WIND_SPD_TOO_LONG: 7 }, { SIM_WIND_SPD: true }];
      const statuses = await Promise.all(rejected.map(async (params) => (await request.post("/api/params", { data: { params } })).status()));
      expect(statuses).toEqual(rejected.map(() => 400));
    });
  });

  test.describe("Car", () => {
    const panelOf = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: "Car", exact: true }) });

    test.afterEach(async ({ request }) => {
      await request.post("/api/car", { data: { speed: 8 } });
    });

    test("the slider sets how fast the car drives", async ({ page, request }) => {
      await page.goto("/");
      const panel = panelOf(page);
      await panel.getByRole("slider", { name: "Car speed" }).fill("12");
      await expect(panel.getByText("m/s · 43 km/h")).toBeVisible();
      await expect.poll(async () => (await (await request.get("/api/car")).json()).speed).toBe(12);
    });

    test("the car drives the road, its distance from the drone counting live", async ({ page }) => {
      await page.goto("/");
      const away = panelOf(page).getByText(/^\d+ m away$/);
      await expect(away).toBeVisible({ timeout: 15_000 });
      const first = await away.textContent();
      await expect(away).not.toHaveText(first ?? "", { timeout: 10_000 });
    });

    test("the car API refuses a speed off the slider", async ({ request }) => {
      expect((await request.post("/api/car", { data: { speed: 21 } })).status()).toBe(400);
      expect((await request.post("/api/car", { data: { speed: -1 } })).status()).toBe(400);
    });
  });

  test("lists the ports the simulator exposes", async ({ page }) => {
    await page.goto("/");
    for (const port of ["TCP 5760", "UDP 14550", "FlightGear 9005"]) {
      await expect(page.getByText(port, { exact: true })).toBeVisible();
    }
  });
});
