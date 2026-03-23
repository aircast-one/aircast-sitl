import { Link } from "react-router-dom";
import { useTelemetry } from "../hooks/useTelemetry.ts";

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

export function DashboardPage() {
  const telemetry = useTelemetry();

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 to-purple-700 text-white">
      <div className="max-w-3xl mx-auto px-8 py-12 text-center">
        <h1 className="text-5xl font-bold mb-3 drop-shadow-md">
          Aircast SITL
        </h1>
        <p className="text-lg opacity-90 mb-10">
          ArduPilot Software-in-the-Loop Simulator
        </p>

        {/* Status */}
        <div className="bg-white/10 backdrop-blur rounded-xl p-6 mb-8 border border-white/20">
          <h2 className="text-xl font-semibold flex items-center justify-center gap-2">
            <span
              className={`w-3 h-3 rounded-full ${telemetry.connected ? "bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.5)]" : "bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.5)]"}`}
            />
            SITL Status: {telemetry.connected ? "Connected" : "Disconnected"}
          </h2>
          <p className="mt-1 opacity-80">
            {telemetry.connected
              ? "ArduCopter SITL is active and ready for connections"
              : "Waiting for SITL connection..."}
          </p>
        </div>

        {/* FPV Card */}
        <Link
          to="/fpv"
          className="block bg-white/10 backdrop-blur rounded-xl p-6 mb-8 border border-white/20 hover:bg-white/20 transition-colors cursor-pointer"
        >
          <h3 className="text-amber-300 font-bold mb-2">3D FPV View</h3>
          <p className="text-sm opacity-90 font-mono">
            Open the CesiumJS 3D drone view
            <br />
            with live MAVLink telemetry overlay
          </p>
        </Link>

        {/* Connection Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          {connections.map((c) => (
            <button
              key={c.title}
              onClick={() => navigator.clipboard.writeText(c.info)}
              className="bg-white/10 backdrop-blur rounded-lg p-5 border border-white/20 text-left hover:bg-green-400/10 transition-colors cursor-pointer"
            >
              <h3 className="text-amber-300 font-bold mb-2">{c.title}</h3>
              <pre className="text-xs opacity-90 font-mono whitespace-pre-wrap">
                {c.info}
              </pre>
            </button>
          ))}
        </div>

        {/* Ports */}
        <div className="bg-white/10 backdrop-blur rounded-xl p-6 border border-white/20 mb-8">
          <h3 className="font-semibold mb-3">Available Ports</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {["TCP: 5760-5765", "UDP: 14550-14555", "FlightGear: 9005"].map(
              (port) => (
                <div
                  key={port}
                  className="bg-white/5 rounded-md py-2 px-3 font-mono text-sm"
                >
                  {port}
                </div>
              ),
            )}
          </div>
        </div>

        <p className="opacity-60 text-sm">
          Aircast SITL &mdash; Multi-Architecture ArduPilot Simulator
        </p>
      </div>
    </div>
  );
}
