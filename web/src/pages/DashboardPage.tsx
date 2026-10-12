import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Check, Copy, LoaderCircle, RotateCcw } from "lucide-react";
import { useTelemetry, type Telemetry } from "@/hooks/useTelemetry.ts";
import { AirframeIcon, type AirframeId } from "@/components/Airframe.tsx";
import { Attitude } from "@/components/Attitude.tsx";
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
  const [switching, setSwitching] = useState<AirframeId | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const host = window.location.hostname || "localhost";

  useEffect(() => {
    fetch("/api/vehicle")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.vehicle && setAirframe(data.vehicle))
      .catch(() => undefined);
  }, []);

  const restart = async (target: AirframeId | "reset", request: () => Promise<Response>) => {
    setSwitching(target);
    setError(null);
    try {
      const res = await request();
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "The simulator did not restart");
      }
      return res.ok;
    } catch {
      setError("Network error");
      return false;
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
            error={error}
            telemetry={telemetry}
            link={link}
            onSelect={handleAirframe}
            onReset={handleReset}
          />
          <TelemetryPanel telemetry={telemetry} live={link === "live"} />
        </div>
        <aside className="flex min-w-0 flex-col gap-4">
          <ConnectPanel host={host} />
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
  switching: AirframeId | "reset" | null;
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
          3D view <ArrowUpRight className="size-3.5" />
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

function ViewsPanel() {
  const views = [
    { to: "/fpv", title: "3D FPV view", text: "CesiumJS terrain with the live aircraft and HUD" },
    { to: "/camera", title: "Onboard camera", text: "Rendered gimbal camera for RTSP and WHIP" },
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
              <ArrowUpRight className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
