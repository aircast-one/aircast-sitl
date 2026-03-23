import type { Telemetry } from "../hooks/useTelemetry.ts";

const toDeg = (r: number) => ((r * 180) / Math.PI).toFixed(1);

interface HudProps {
  telemetry: Telemetry;
}

function HudItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-1.5">
      <div className="text-[10px] opacity-70 uppercase tracking-wider">
        {label}
      </div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

export function Hud({ telemetry }: HudProps) {
  return (
    <>
      {/* Attitude - top left */}
      <div className="fixed top-4 left-4 text-green-400 font-mono text-sm z-10 pointer-events-none [text-shadow:0_0_4px_rgba(0,255,0,0.5)]">
        <HudItem label="Roll" value={`${toDeg(telemetry.roll)}\u00B0`} />
        <HudItem label="Pitch" value={`${toDeg(telemetry.pitch)}\u00B0`} />
        <HudItem label="Yaw" value={`${toDeg(telemetry.yaw)}\u00B0`} />
      </div>

      {/* Position - top right */}
      <div className="fixed top-4 right-4 text-green-400 font-mono text-sm text-right z-10 pointer-events-none [text-shadow:0_0_4px_rgba(0,255,0,0.5)]">
        <HudItem label="Alt AGL" value={`${telemetry.relativeAlt.toFixed(1)} m`} />
        <HudItem label="Speed" value={`${telemetry.groundspeed.toFixed(1)} m/s`} />
        <HudItem label="Heading" value={`${Math.round(telemetry.heading)}\u00B0`} />
      </div>

      {/* Status - bottom left */}
      <div className="fixed bottom-4 left-4 text-green-400 font-mono text-sm z-10 pointer-events-none [text-shadow:0_0_4px_rgba(0,255,0,0.5)]">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              telemetry.connected
                ? "bg-green-400 shadow-[0_0_6px_#0f0]"
                : "bg-red-500 shadow-[0_0_6px_#f00]"
            }`}
          />
          <span>{telemetry.connected ? "Connected" : "Connecting..."}</span>
        </div>
        {telemetry.armed && (
          <div className="text-lg font-bold text-red-500">ARMED</div>
        )}
      </div>

      {/* GPS - bottom right */}
      <div className="fixed bottom-4 right-4 text-green-400 font-mono text-sm text-right z-10 pointer-events-none [text-shadow:0_0_4px_rgba(0,255,0,0.5)]">
        <div className="mb-1">
          <span className="text-[10px] opacity-70 uppercase tracking-wider">Lat</span>{" "}
          {telemetry.lat.toFixed(7)}
        </div>
        <div>
          <span className="text-[10px] opacity-70 uppercase tracking-wider">Lng</span>{" "}
          {telemetry.lng.toFixed(7)}
        </div>
      </div>
    </>
  );
}
