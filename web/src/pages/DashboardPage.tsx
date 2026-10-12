import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Copy, ExternalLink, RotateCcw } from "lucide-react";
import { useTelemetry } from "@/hooks/useTelemetry.ts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";

const connections = [
  {
    title: "MAVProxy",
    info: "mavproxy.py --master=tcp://sitl.aircast.one:5760",
  },
  {
    title: "QGroundControl",
    info: "UDP Connection:\nHost: sitl.aircast.one\nPort: 14550",
  },
  {
    title: "Mission Planner",
    info: "TCP Connection:\nHost: sitl.aircast.one\nPort: 5760",
  },
  {
    title: "Python MAVLink",
    info: 'from pymavlink import mavutil\nconn = mavutil.mavlink_connection(\n  "tcp:sitl.aircast.one:5760")',
  },
];

const vehicles = [
  { id: "copter", label: "Copter", firmware: "ArduCopter" },
  { id: "plane", label: "Plane", firmware: "ArduPlane" },
  { id: "quadplane", label: "QuadPlane", firmware: "ArduPlane QuadPlane" },
] as const;

type VehicleId = (typeof vehicles)[number]["id"];

export function DashboardPage() {
  const telemetry = useTelemetry();
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<VehicleId | null>(null);
  const firmware = vehicles.find((v) => v.id === vehicle)?.firmware ?? "ArduPilot";

  useEffect(() => {
    fetch("/api/vehicle")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.vehicle && setVehicle(data.vehicle))
      .catch(() => undefined);
  }, []);

  const restart = async (request: () => Promise<Response>) => {
    setResetting(true);
    setResetError(null);
    try {
      const res = await request();
      if (!res.ok) {
        const data = await res.json();
        setResetError(data.error ?? "Reset failed");
      }
      return res.ok;
    } catch {
      setResetError("Network error");
      return false;
    } finally {
      setResetting(false);
    }
  };

  const handleReset = () => restart(() => fetch("/api/reset", { method: "POST" }));

  const handleVehicle = async (id: VehicleId) => {
    const switched = await restart(() =>
      fetch("/api/vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicle: id }),
      }),
    );
    if (switched) setVehicle(id);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-8 py-12 text-center">
        <h1 className="text-5xl font-bold mb-3 tracking-tight">
          Aircast SITL
        </h1>
        <p className="text-lg text-muted-foreground mb-10">
          ArduPilot Software-in-the-Loop Simulator
        </p>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center justify-center gap-2 text-xl">
              <span
                className={cn(
                  "w-3 h-3 rounded-full",
                  telemetry.connected
                    ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]"
                    : "bg-destructive shadow-[0_0_10px_rgba(239,68,68,0.5)]",
                )}
              />
              SITL Status:{" "}
              {telemetry.connected ? "Connected" : "Disconnected"}
            </CardTitle>
            <CardDescription>
              {telemetry.connected
                ? `${firmware} SITL is active and ready for connections`
                : "Waiting for SITL connection..."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-2">
            <div role="group" aria-label="Vehicle" className="flex gap-2">
              {vehicles.map((v) => (
                <Button
                  key={v.id}
                  size="sm"
                  variant={v.id === vehicle ? "default" : "outline"}
                  aria-pressed={v.id === vehicle}
                  disabled={resetting || vehicle === null}
                  onClick={() => v.id !== vehicle && handleVehicle(v.id)}
                >
                  {v.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Switching restarts the simulator for everyone connected
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={resetting}
            >
              <RotateCcw className={cn("h-4 w-4", resetting && "animate-spin")} />
              {resetting ? "Resetting..." : "Reset SITL"}
            </Button>
            {resetError && (
              <p className="text-xs text-destructive">{resetError}</p>
            )}
          </CardContent>
        </Card>

        <Card className="mb-8 hover:bg-accent/50 transition-colors">
          <Link to="/fpv" className="block">
            <CardHeader>
              <CardTitle className="flex items-center justify-center gap-2">
                <ExternalLink className="h-4 w-4" />
                3D FPV View
              </CardTitle>
              <CardDescription className="font-mono">
                Open the CesiumJS 3D drone view
                <br />
                with live MAVLink telemetry overlay
              </CardDescription>
            </CardHeader>
          </Link>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          {connections.map((c) => (
            <Card
              key={c.title}
              className="text-left hover:bg-accent/50 transition-colors cursor-pointer"
              onClick={() => navigator.clipboard.writeText(c.info)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Copy className="h-3 w-3 text-muted-foreground" />
                  {c.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">
                  {c.info}
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-sm">Available Ports</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap justify-center gap-2">
              {["TCP: 5760", "UDP: 14550", "FlightGear: 9005"].map(
                (port) => (
                  <Badge key={port} variant="secondary" className="font-mono">
                    {port}
                  </Badge>
                ),
              )}
            </div>
          </CardContent>
        </Card>

        <p className="text-sm text-muted-foreground">
          Aircast SITL &mdash; Multi-Architecture ArduPilot Simulator
        </p>
      </div>
    </div>
  );
}
