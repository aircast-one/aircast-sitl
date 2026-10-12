import { useEffect, useRef, useState } from "react";
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
    info: "TCP Connection:\nHost: sitl.aircast.one\nPort: 5760",
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

export function DashboardPage() {
  const telemetry = useTelemetry();
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const sawDisconnect = useRef(false);

  const handleReset = async () => {
    setResetting(true);
    setResetError(null);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setResetError(data.error ?? "Reset failed");
        setResetting(false);
      }
    } catch {
      setResetError("Network error");
      setResetting(false);
    }
  };

  // Clear resetting when telemetry drops then reconnects after reset
  useEffect(() => {
    if (!resetting) {
      sawDisconnect.current = false;
      return;
    }
    if (!telemetry.connected) {
      sawDisconnect.current = true;
    }
    if (sawDisconnect.current && telemetry.connected) {
      setResetting(false);
    }
  }, [resetting, telemetry.connected]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-8 py-12 text-center">
        <h1 className="text-5xl font-bold mb-3 tracking-tight">
          Aircast SITL
        </h1>
        <p className="text-lg text-muted-foreground mb-10">
          ArduPilot Software-in-the-Loop Simulator
        </p>

        {/* Status */}
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
                ? "ArduCopter SITL is active and ready for connections"
                : "Waiting for SITL connection..."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-2">
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

        {/* FPV Card */}
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

        {/* Connection Cards */}
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

        {/* Ports */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-sm">Available Ports</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap justify-center gap-2">
              <Badge variant="secondary" className="font-mono">
                TCP: 5760
              </Badge>
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
