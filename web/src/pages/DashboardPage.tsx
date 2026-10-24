import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Cartographic, EllipsoidGeodesic } from "cesium";
import { ArrowRight, Check, Copy, LoaderCircle, MapPin, Plus, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useTelemetry, type Telemetry } from "@/hooks/useTelemetry.ts";
import { AirframeIcon, type AirframeId } from "@/components/Airframe.tsx";
import { Attitude } from "@/components/Attitude.tsx";
import { LocationMap, type LatLng } from "@/components/LocationMap.tsx";
import { Button } from "@/components/ui/button.tsx";
import { modeName } from "@/lib/modes.ts";
import { cn } from "@/lib/utils.ts";

const HEARTBEAT_STALE_MS = 3000;
const COPIED_MS = 1200;

const airframes = [
  { id: "copter", label: "Copter", firmware: "ArduCopter", sub: "ArduCopter", modes: "copter" },
  { id: "plane", label: "Plane", firmware: "ArduPlane", sub: "ArduPlane", modes: "plane" },
  { id: "quadplane", label: "QuadPlane", firmware: "ArduPlane QuadPlane", sub: "ArduPlane VTOL", modes: "plane" },
] as const satisfies readonly { id: AirframeId; label: string; firmware: string; sub: string; modes: "copter" | "plane" }[];

type LinkState = "live" | "waiting" | "offline";
type Restart = AirframeId | "reset" | "home" | "params";
type RestartError = { target: Restart; text: string };
type Home = LatLng & { alt: number };
type Params = Record<string, number>;
type CarSpeed = { speed: number; max: number };

const COORDINATES = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/;

function parseCoordinates(text: string): LatLng | null {
  const match = COORDINATES.exec(text);
  const [lat, lng] = match ? [Number(match[1]), Number(match[2])] : [NaN, NaN];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

const formatCoordinates = ({ lat, lng }: LatLng) => `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

const PARAM_NAME = /^[A-Za-z]\w*$/;
const PARAM_NAME_LENGTH = 16;

type ParamLine = { number: number; words: readonly string[] };
type ParsedParams = { params: Params; problems: readonly string[] };

const paramWords = (line: string) => line.replace(/#.*/, "").trim().split(/[\s,=]+/).filter(Boolean);

function lineProblem([name = "", value, ...rest]: readonly string[]): string | null {
  if (value === undefined || rest.length > 0) return "write it as NAME value";
  if (!PARAM_NAME.test(name)) return `${name} is not a parameter name`;
  if (name.length > PARAM_NAME_LENGTH) return `${name} is longer than ${PARAM_NAME_LENGTH} characters`;
  return Number.isFinite(Number(value)) ? null : `“${value}” is not a number`;
}

function parseParams(text: string): ParsedParams {
  const lines: readonly ParamLine[] = text
    .split("\n")
    .map((line, index) => ({ number: index + 1, words: paramWords(line) }))
    .filter((line) => line.words.length > 0);
  return {
    params: Object.fromEntries(lines.map(({ words: [name = "", value] }) => [name.toUpperCase(), Number(value)])),
    problems: lines.flatMap(({ number, words }) => {
      const problem = lineProblem(words);
      return problem ? [`Line ${number}: ${problem}`] : [];
    }),
  };
}

const formatParams = (params: Params) =>
  Object.entries(params)
    .map(([name, value]) => `${name} ${value}`)
    .join("\n");

type Preset = { label: string; note: string; params: Params };

const presets: readonly Preset[] = [
  {
    label: "Gripper",
    note: "Gripper on output 12, closing 2 s after each release",
    params: { GRIP_ENABLE: 1, GRIP_TYPE: 1, SERVO12_FUNCTION: 28, GRIP_AUTOCLOSE: 2 },
  },
  {
    label: "4 drop bays",
    note: "Outputs 9–12 free for a servo per bay, gimbal moved to 13–14",
    params: { SERVO9_FUNCTION: 0, SERVO10_FUNCTION: 0, SERVO11_FUNCTION: 0, SERVO13_FUNCTION: 7, SERVO14_FUNCTION: 6 },
  },
  { label: "Wind", note: "Wind 7 m/s from the west", params: { SIM_WIND_SPD: 7, SIM_WIND_DIR: 270 } },
  { label: "Low battery", note: "Battery under its low-voltage limit, so arming is refused", params: { SIM_BATT_VOLTAGE: 10.4, BATT_LOW_VOLT: 10.5 } },
];

const presetActive = (preset: Preset, params: Params) =>
  Object.entries(preset.params).every(([name, value]) => params[name] === value);

function togglePreset(text: string, preset: Preset, active: boolean): string {
  const kept = text
    .split("\n")
    .filter((line) => line.trim() !== `# ${preset.note}` && !((paramWords(line)[0] ?? "").toUpperCase() in preset.params))
    .join("\n")
    .trim();
  const added = active ? [] : [`# ${preset.note}`, formatParams(preset.params)];
  return [kept, ...added].filter(Boolean).join("\n");
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function linkState(telemetry: Telemetry, now: number): LinkState {
  if (!telemetry.connected) return "offline";
  return telemetry.heartbeatAt !== null && now - telemetry.heartbeatAt < HEARTBEAT_STALE_MS ? "live" : "waiting";
}

export function DashboardPage() {
  const telemetry = useTelemetry();
  const now = useNow(500);
  const link = linkState(telemetry, now);
  const [airframe, setAirframe] = useState<AirframeId | null>(null);
  const [home, setHome] = useState<Home | null>(null);
  const [params, setParams] = useState<Params | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  const [switching, setSwitching] = useState<Restart | null>(null);
  const [error, setError] = useState<RestartError | null>(null);
  const [car, setCar] = useState<CarSpeed | null>(null);
  const [carError, setCarError] = useState<string | null>(null);
  const host = window.location.hostname || "localhost";

  useEffect(() => {
    fetch("/api/vehicle")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.vehicle && setAirframe(data.vehicle))
      .catch(() => undefined);
    fetch("/api/home")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setHome(data))
      .catch(() => undefined);
    fetch("/api/params")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.params && setParams(data.params))
      .catch(() => undefined);
    fetch("/api/car")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setCar(data))
      .catch(() => undefined);
  }, []);

  const restart = async (target: Restart, request: () => Promise<Response>) => {
    setSwitching(target);
    setError(null);
    try {
      const res = await request();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError({ target, text: data.error ?? "The simulator did not restart" });
      return res.ok ? data : null;
    } catch {
      setError({ target, text: "Network error" });
      return null;
    } finally {
      setSwitching(null);
    }
  };

  const handleAirframe = async (id: AirframeId) => {
    if (id === airframe) return;
    const switched = await restart(id, () =>
      fetch("/api/vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicle: id }),
      }),
    );
    if (switched) setAirframe(id);
  };

  const handleReset = () => restart("reset", () => fetch("/api/reset", { method: "POST" }));

  const handleHome = async (at: LatLng) => {
    const moved = await restart("home", () =>
      fetch("/api/home", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(at),
      }),
    );
    if (moved) setHome(moved);
  };

  const handleParams = async (next: Params) => {
    setApplied(null);
    const result = await restart("params", () =>
      fetch("/api/params", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params: next }),
      }),
    );
    if (result) {
      setParams(result.params);
      setApplied(Object.keys(result.params).length);
    }
  };

  const handleCarSpeed = async (speed: number) => {
    setCar((prev) => prev && { ...prev, speed });
    setCarError(null);
    const res = await fetch("/api/car", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speed }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (!res?.ok) setCarError(data?.error ?? "Network error");
  };

  const errorFor = (targets: readonly Restart[]) => (error && targets.includes(error.target) ? error.text : null);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <AirframeIcon airframe="copter" className="size-6 text-muted-foreground" />
          <h1 className="text-[15px] font-semibold tracking-tight">Aircast SITL</h1>
          <span className="hidden text-[13px] text-muted-foreground sm:inline">ArduPilot simulator</span>
          <div className="ml-auto flex items-center gap-3">
            <LinkStatus link={link} telemetry={telemetry} now={now} />
            <span className="hidden font-mono text-xs text-muted-foreground md:inline">{host}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-4 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <AirframePanel
            airframe={airframe}
            switching={switching}
            error={errorFor(["reset", ...airframes.map((a) => a.id)])}
            telemetry={telemetry}
            link={link}
            onSelect={handleAirframe}
            onReset={handleReset}
          />
          <LocationPanel
            home={home}
            switching={switching}
            error={errorFor(["home"])}
            onMove={handleHome}
          />
          <ParamsPanel params={params} applied={applied} switching={switching} error={errorFor(["params"])} onApply={handleParams} />
          <TelemetryPanel telemetry={telemetry} live={link === "live"} />
        </div>
        <aside className="flex min-w-0 flex-col gap-4">
          <ConnectPanel host={host} />
          <CarPanel car={car} telemetry={telemetry} live={link === "live"} error={carError} onSpeed={handleCarSpeed} />
          <ViewsPanel />
        </aside>
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-muted-foreground sm:px-6">
        ArduPilot SITL in Docker for AMD64 and ARM64 · GPL-3.0 ·{" "}
        <a className="underline-offset-4 hover:text-foreground hover:underline" href="https://github.com/aircast-one/aircast-sitl">
          Source on GitHub
        </a>
      </footer>
    </div>
  );
}

function Panel({ label, action, children, className }: { label: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-border/70 bg-card", className)}>
      <div className="flex h-11 items-center justify-between border-b border-border/50 px-5">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function LinkStatus({ link, telemetry, now }: { link: LinkState; telemetry: Telemetry; now: number }) {
  const silentFor = telemetry.heartbeatAt === null ? null : Math.round((now - telemetry.heartbeatAt) / 1000);
  const text = {
    live: "Live",
    waiting: silentFor === null ? "Waiting for heartbeat" : `No heartbeat for ${silentFor} s`,
    offline: "Dashboard offline",
  }[link];
  const tone = { live: "bg-success", waiting: "bg-warning", offline: "bg-destructive" }[link];
  return (
    <div role="status" className="flex items-center gap-2 rounded-full border border-border/70 px-3 py-1 text-xs font-medium">
      <span className="relative flex size-2">
        {link === "live" && (
          <span key={telemetry.heartbeatAt} className={cn("absolute inset-0 rounded-full motion-safe:animate-beat", tone)} />
        )}
        <span className={cn("relative size-2 rounded-full", tone)} />
      </span>
      <span className="tabular-nums">{text}</span>
    </div>
  );
}

function AirframePanel({
  airframe,
  switching,
  error,
  telemetry,
  link,
  onSelect,
  onReset,
}: {
  airframe: AirframeId | null;
  switching: Restart | null;
  error: string | null;
  telemetry: Telemetry;
  link: LinkState;
  onSelect: (id: AirframeId) => void;
  onReset: () => void;
}) {
  const current = airframes.find((a) => a.id === airframe);
  const live = link === "live";
  return (
    <Panel
      label="Airframe"
      action={
        <Button variant="ghost" size="sm" className="-mr-2 h-8 text-muted-foreground" onClick={onReset} disabled={switching !== null}>
          <RotateCcw className={cn("size-3.5", switching === "reset" && "motion-safe:animate-spin")} />
          {switching === "reset" ? "Resetting…" : "Reset SITL"}
        </Button>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="text-[28px] font-semibold leading-none tracking-tight">{current?.firmware ?? "ArduPilot"}</p>
          <p className="mt-2 text-[13px] text-muted-foreground">
            {live && current ? `${modeName(current.modes, telemetry.mode)} mode` : link === "offline" ? "Not connected" : "Starting…"}
          </p>
        </div>
        <ArmedState armed={telemetry.armed} live={live} />
      </div>

      <div role="group" aria-label="Vehicle" className="mt-5 grid grid-cols-3 gap-2">
        {airframes.map((a) => {
          const selected = a.id === airframe;
          const pending = switching === a.id;
          return (
            <button
              key={a.id}
              type="button"
              aria-label={a.label}
              aria-pressed={selected}
              disabled={switching !== null || airframe === null}
              onClick={() => onSelect(a.id)}
              className={cn(
                "group flex flex-col items-center gap-2 rounded-lg border px-2 pb-3 pt-4 text-center transition-[background-color,border-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:cursor-not-allowed",
                selected
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground enabled:hover:border-foreground/25 enabled:hover:text-foreground disabled:opacity-60",
              )}
            >
              {pending ? (
                <LoaderCircle className="size-11 p-2 motion-safe:animate-spin" />
              ) : (
                <AirframeIcon airframe={a.id} className="size-11" />
              )}
              <span className="text-[13px] font-medium">{a.label}</span>
              <span className="text-[11px] text-muted-foreground">{pending ? "Restarting…" : a.sub}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Switching restarts the simulator for everyone connected.
        {error && <span className="ml-1 text-destructive">{error}</span>}
      </p>
    </Panel>
  );
}

function LocationPanel({
  home,
  switching,
  error,
  onMove,
}: {
  home: Home | null;
  switching: Restart | null;
  error: string | null;
  onMove: (at: LatLng) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (home ? formatCoordinates(home) : "");
  const pick = parseCoordinates(shown);
  const moved = pick !== null && (home === null || formatCoordinates(pick) !== formatCoordinates(home));
  const moving = switching === "home";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pick && moved) onMove(pick);
  };
  return (
    <Panel
      label="Location"
      action={
        home && (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{`${home.alt.toFixed(0)} m AMSL`}</span>
        )
      }
    >
      <div className="h-64 overflow-hidden rounded-lg border border-border sm:h-72">
        <LocationMap home={home} pick={moved ? pick : null} onPick={(at) => setText(formatCoordinates(at))} />
      </div>
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          aria-label="Coordinates"
          value={shown}
          onChange={(event) => setText(event.target.value)}
          placeholder="lat, lng"
          spellCheck={false}
          aria-invalid={shown !== "" && pick === null}
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 font-mono text-[13px] tabular-nums outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
        />
        <Button type="submit" size="sm" className="h-9" disabled={!moved || switching !== null}>
          {moving ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <MapPin className="size-3.5" />}
          {moving ? "Moving…" : "Move here"}
        </Button>
      </form>
      <p className="mt-3 text-xs text-muted-foreground">
        Click the map, search a place or paste coordinates. Moving restarts the simulator for everyone connected.
        {error && <span className="ml-1 text-destructive">{error}</span>}
      </p>
    </Panel>
  );
}

function ParamsPanel({
  params,
  applied,
  switching,
  error,
  onApply,
}: {
  params: Params | null;
  applied: number | null;
  switching: Restart | null;
  error: string | null;
  onApply: (params: Params) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (params ? formatParams(params) : "");
  const parsed = parseParams(shown);
  const valid = parsed.problems.length === 0;
  const changed = params !== null && valid && formatParams(parsed.params) !== formatParams(params);
  const applying = switching === "params";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (changed) onApply(parsed.params);
  };
  const problems = valid ? (error ? [error] : []) : parsed.problems;
  return (
    <Panel
      label="Parameters"
      action={
        params && <span className="font-mono text-xs tabular-nums text-muted-foreground">{`${Object.keys(params).length} set`}</span>
      }
    >
      <div role="group" aria-label="Presets" className="mb-3 flex flex-wrap gap-2">
        {presets.map((preset) => {
          const active = valid && presetActive(preset, parsed.params);
          return (
            <Button
              key={preset.label}
              type="button"
              variant="outline"
              size="sm"
              title={preset.note}
              aria-pressed={active}
              onClick={() => setText(togglePreset(shown, preset, active))}
              className={cn("h-8", active && "border-primary bg-primary/10")}
            >
              {active ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
              {preset.label}
            </Button>
          );
        })}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <textarea
          aria-label="Parameters"
          value={shown}
          onChange={(event) => setText(event.target.value)}
          placeholder="Empty: the airframe's own defaults"
          rows={6}
          spellCheck={false}
          aria-invalid={!valid}
          aria-describedby="params-problems"
          className="field-sizing-content min-h-32 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-[13px] tabular-nums outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/40"
        />
        <div className="flex items-start gap-3">
          <ul id="params-problems" role="alert" className="min-w-0 flex-1 text-xs text-destructive">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
            {problems.length === 0 && applied !== null && !changed && !applying && (
              <li className="text-success">
                {applied === 0 ? "Restarted with the airframe's own defaults." : `Restarted with ${applied} parameter${applied === 1 ? "" : "s"}.`}
              </li>
            )}
          </ul>
          <Button type="submit" size="sm" className="h-9 shrink-0" disabled={!changed || switching !== null}>
            {applying ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <SlidersHorizontal className="size-3.5" />}
            {applying ? "Applying…" : "Apply"}
          </Button>
        </div>
      </form>
      <p className="mt-3 text-xs text-muted-foreground">
        One <span className="font-mono">NAME value</span> per line, set over the airframe's defaults every time the simulator starts.
        Applying restarts the simulator for everyone connected.
      </p>
    </Panel>
  );
}

function ArmedState({ armed, live }: { armed: boolean; live: boolean }) {
  if (!live) return null;
  return (
    <span
      className={cn(
        "rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
        armed ? "border-warning/50 bg-warning/10 text-warning" : "border-border text-muted-foreground",
      )}
    >
      {armed ? "Armed" : "Disarmed"}
    </span>
  );
}

function TelemetryPanel({ telemetry, live }: { telemetry: Telemetry; live: boolean }) {
  const show = (value: number, digits: number) => (live ? value.toFixed(digits) : "—");
  const degrees = (radians: number) => show((radians * 180) / Math.PI, 0);
  return (
    <Panel
      label="Telemetry"
      action={
        <Link to="/fpv" className="-mr-1 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
          3D view <ArrowRight className="size-3.5" />
        </Link>
      }
    >
      <div className="flex flex-col items-center gap-6 sm:flex-row">
        <Attitude roll={telemetry.roll} pitch={telemetry.pitch} live={live} />
        <dl className="grid w-full flex-1 grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <Readout label="Altitude" value={show(telemetry.relativeAlt, 1)} unit="m" hero />
          <Readout label="Ground speed" value={show(telemetry.groundspeed, 1)} unit="m/s" hero />
          <Readout label="Airspeed" value={show(telemetry.airspeed, 1)} unit="m/s" hero />
          <Readout label="Climb" value={show(telemetry.climb, 1)} unit="m/s" hero />
          <Readout label="Heading" value={show(telemetry.heading, 0)} unit="°" />
          <Readout label="Throttle" value={show(telemetry.throttle, 0)} unit="%" />
          <Readout label="Roll" value={degrees(telemetry.roll)} unit="°" />
          <Readout label="Pitch" value={degrees(telemetry.pitch)} unit="°" />
        </dl>
      </div>
      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-1 border-t border-border/50 pt-4 font-mono text-xs tabular-nums text-muted-foreground">
        <span>LAT {live ? telemetry.lat.toFixed(6) : "—"}</span>
        <span>LON {live ? telemetry.lng.toFixed(6) : "—"}</span>
        <span>AMSL {live ? `${telemetry.alt.toFixed(1)} m` : "—"}</span>
      </div>
    </Panel>
  );
}

function Readout({ label, value, unit, hero }: { label: string; value: string; unit: string; hero?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-1 font-mono tabular-nums">
        <span className={cn("font-semibold", hero ? "text-[22px] leading-none" : "text-[17px] leading-none")}>{value}</span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </dd>
    </div>
  );
}

function ConnectPanel({ host }: { host: string }) {
  const rows = [
    { label: "Aircast · QGC · Mission Planner", hint: "TCP", value: `${host}:5760` },
    { label: "QGroundControl", hint: "UDP", value: `${host}:14550` },
    {
      label: "Aircast in the browser",
      hint: "WebSocket",
      value: window.location.protocol === "https:" ? `wss://${host}/ws/mavlink` : `ws://${host}:8889/ws/mavlink`,
    },
    { label: "MAVProxy", hint: "CLI", value: `mavproxy.py --master=tcp:${host}:5760` },
    { label: "Python MAVLink", hint: "pymavlink", value: `mavutil.mavlink_connection("tcp:${host}:5760")` },
  ];
  return (
    <Panel label="Connect">
      <ul className="-my-2 divide-y divide-border/50">
        {rows.map((row) => (
          <CopyRow key={row.label} {...row} />
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">
        Ports <span className="font-mono">TCP 5760</span> · <span className="font-mono">UDP 14550</span> ·{" "}
        <span className="font-mono">FlightGear 9005</span>
      </p>
    </Panel>
  );
}

function CopyRow({ label, hint, value }: { label: string; hint: string; value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(id);
  }, [copied]);
  const copy = () => navigator.clipboard.writeText(value).then(() => setCopied(true));
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 text-[13px] font-medium">
          {label}
          <span className="text-[11px] font-normal text-muted-foreground">{hint}</span>
        </p>
        <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={value}>
          {value}
        </p>
      </div>
      <Button variant="ghost" size="icon" className="size-9 shrink-0 text-muted-foreground" aria-label={`Copy ${label}`} onClick={copy}>
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
      </Button>
    </li>
  );
}

function metersBetween(a: LatLng, b: LatLng) {
  return new EllipsoidGeodesic(Cartographic.fromDegrees(a.lng, a.lat), Cartographic.fromDegrees(b.lng, b.lat)).surfaceDistance;
}

function CarPanel({
  car,
  telemetry,
  live,
  error,
  onSpeed,
}: {
  car: CarSpeed | null;
  telemetry: Telemetry;
  live: boolean;
  error: string | null;
  onSpeed: (speed: number) => void;
}) {
  const distance = live && telemetry.car ? metersBetween(telemetry, telemetry.car) : null;
  return (
    <Panel
      label="Car"
      action={
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {distance === null ? "—" : `${distance.toFixed(0)} m away`}
        </span>
      }
    >
      <dl>
        <Readout
          label="Speed"
          value={car ? car.speed.toFixed(0) : "—"}
          unit={car ? `m/s · ${(car.speed * 3.6).toFixed(0)} km/h` : "m/s"}
          hero
        />
      </dl>
      <input
        type="range"
        aria-label="Car speed"
        min={0}
        max={car?.max ?? 0}
        step={1}
        value={car?.speed ?? 0}
        disabled={!car}
        onChange={(event) => onSpeed(Number(event.target.value))}
        className="mt-4 w-full accent-primary"
      />
      <p className="mt-3 text-xs text-muted-foreground">
        Drives the road ahead of home and back. Switch the copter to Follow to chase it 20 m behind.
        {error && <span className="ml-1 text-destructive">{error}</span>}
      </p>
    </Panel>
  );
}

function ViewsPanel() {
  const views = [
    { to: "/fpv", title: "3D view", text: "CesiumJS terrain with the live aircraft and HUD" },
    { to: "/camera", title: "FPV camera", text: "What the tracking gimbal streams" },
    { to: "/camera?gimbal=2", title: "Payload camera", text: "What the payload gimbal streams" },
  ];
  return (
    <Panel label="Views">
      <ul className="-my-1 flex flex-col">
        {views.map((view) => (
          <li key={view.to}>
            <Link to={view.to} className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{view.title}</p>
                <p className="truncate text-xs text-muted-foreground">{view.text}</p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
