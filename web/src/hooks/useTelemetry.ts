import { useEffect, useRef, useState, useCallback } from "react";

export interface Telemetry {
  roll: number;
  pitch: number;
  yaw: number;
  lat: number;
  lng: number;
  alt: number;
  relativeAlt: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  groundspeed: number;
  airspeed: number;
  climb: number;
  throttle: number;
  armed: boolean;
  mode: number | null;
  heartbeatAt: number | null;
  connected: boolean;
  homeSet: boolean;
  homeLat: number;
  homeLng: number;
  gimbal: Gimbal | null;
}

export interface Gimbal {
  pitch: number;
  yaw: number;
  earthYaw: boolean;
}

const initialTelemetry: Telemetry = {
  roll: 0,
  pitch: 0,
  yaw: 0,
  lat: 0,
  lng: 0,
  alt: 0,
  relativeAlt: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  heading: 0,
  groundspeed: 0,
  airspeed: 0,
  climb: 0,
  throttle: 0,
  armed: false,
  mode: null,
  heartbeatAt: null,
  connected: false,
  homeSet: false,
  homeLat: 0,
  homeLng: 0,
  gimbal: null,
};

interface MavlinkMessage {
  type: string;
  [key: string]: unknown;
}

export function useTelemetry() {
  const [telemetry, setTelemetry] = useState<Telemetry>(initialTelemetry);
  const telemetryRef = useRef<Telemetry>(initialTelemetry);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleMessage = useCallback((msg: MavlinkMessage) => {
    const prev = telemetryRef.current;
    let next = prev;

    switch (msg.type) {
      case "ATTITUDE":
        next = {
          ...prev,
          roll: msg.roll as number,
          pitch: msg.pitch as number,
          yaw: msg.yaw as number,
        };
        break;
      case "GLOBAL_POSITION_INT": {
        const lat = msg.lat as number;
        const lng = msg.lng as number;
        const homeSet = prev.homeSet || lat !== 0;
        next = {
          ...prev,
          lat,
          lng,
          alt: msg.alt as number,
          relativeAlt: msg.relative_alt as number,
          vx: msg.vx as number,
          vy: msg.vy as number,
          vz: msg.vz as number,
          heading: msg.hdg as number,
          homeSet,
          homeLat: homeSet && !prev.homeSet ? lat : prev.homeLat,
          homeLng: homeSet && !prev.homeSet ? lng : prev.homeLng,
        };
        break;
      }
      case "VFR_HUD":
        next = {
          ...prev,
          groundspeed: msg.groundspeed as number,
          airspeed: msg.airspeed as number,
          heading: msg.heading as number,
          throttle: msg.throttle as number,
          climb: msg.climb as number,
        };
        break;
      case "GIMBAL":
        next = { ...prev, gimbal: { pitch: msg.pitch as number, yaw: msg.yaw as number, earthYaw: msg.earth_yaw as boolean } };
        break;
      case "HEARTBEAT":
        next = { ...prev, armed: msg.armed as boolean, mode: msg.mode as number, heartbeatAt: Date.now() };
        break;
    }

    telemetryRef.current = next;
    setTelemetry(next);
  }, []);

  const connect = useCallback(() => {
    const isSecure = window.location.protocol === "https:";
    const wsHost = window.location.hostname || "localhost";
    const wsUrl = isSecure
      ? `wss://${wsHost}/ws`
      : `ws://${wsHost}:8889`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      telemetryRef.current = { ...telemetryRef.current, connected: true };
      setTelemetry(telemetryRef.current);
    };

    ws.onclose = () => {
      telemetryRef.current = { ...telemetryRef.current, connected: false };
      setTelemetry(telemetryRef.current);
      reconnectRef.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => ws.close();

    ws.onmessage = (event) => {
      try {
        handleMessage(JSON.parse(event.data));
      } catch {
        return;
      }
    };
  }, [handleMessage]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return telemetry;
}
