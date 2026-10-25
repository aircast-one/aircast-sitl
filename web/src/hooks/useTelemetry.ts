import { useEffect, useState } from "react";

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
  gimbals: Readonly<Record<number, Gimbal>>;
  car: Car | null;
}

export interface Car {
  lat: number;
  lng: number;
  heading: number;
}

interface Gimbal {
  roll: number;
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
  gimbals: {},
  car: null,
};

interface MavlinkMessage {
  type: string;
  [key: string]: unknown;
}

const RECONNECT_MS = 2000;

export function bridgeUrl() {
  const wsHost = window.location.hostname || "localhost";
  return window.location.protocol === "https:" ? `wss://${wsHost}/ws` : `ws://${wsHost}:8889`;
}

const parse = (data: string): MavlinkMessage | undefined => {
  try {
    return (JSON.parse(data) as MavlinkMessage | null) ?? undefined;
  } catch {
    return undefined;
  }
};

const withPosition = (prev: Telemetry, msg: MavlinkMessage): Telemetry => {
  const lat = msg.lat as number;
  const lng = msg.lng as number;
  const fix = lat !== 0 || lng !== 0;
  const rehome = fix && (!prev.homeSet || !prev.armed);
  return {
    ...prev,
    lat,
    lng,
    alt: msg.alt as number,
    relativeAlt: msg.relative_alt as number,
    vx: msg.vx as number,
    vy: msg.vy as number,
    vz: msg.vz as number,
    heading: msg.hdg as number,
    homeSet: prev.homeSet || fix,
    homeLat: rehome ? lat : prev.homeLat,
    homeLng: rehome ? lng : prev.homeLng,
  };
};

const applyMessage = (prev: Telemetry, msg: MavlinkMessage): Telemetry => {
  switch (msg.type) {
    case "ATTITUDE":
      return { ...prev, roll: msg.roll as number, pitch: msg.pitch as number, yaw: msg.yaw as number };
    case "GLOBAL_POSITION_INT":
      return withPosition(prev, msg);
    case "VFR_HUD":
      return {
        ...prev,
        groundspeed: msg.groundspeed as number,
        airspeed: msg.airspeed as number,
        heading: msg.heading as number,
        throttle: msg.throttle as number,
        climb: msg.climb as number,
      };
    case "GIMBAL":
      return {
        ...prev,
        gimbals: {
          ...prev.gimbals,
          [msg.device as number]: {
            roll: msg.roll as number,
            pitch: msg.pitch as number,
            yaw: msg.yaw as number,
            earthYaw: msg.earth_yaw as boolean,
          },
        },
      };
    case "CAR":
      return { ...prev, car: { lat: msg.lat as number, lng: msg.lng as number, heading: ((msg.hdg as number) * Math.PI) / 180 } };
    case "HEARTBEAT":
      return { ...prev, armed: msg.armed as boolean, mode: msg.mode as number, heartbeatAt: Date.now() };
    default:
      return prev;
  }
};

export function useTelemetry() {
  const [telemetry, setTelemetry] = useState<Telemetry>(initialTelemetry);

  useEffect(() => {
    const link: { socket?: WebSocket; retry?: ReturnType<typeof setTimeout>; stopped: boolean } = { stopped: false };
    const setConnected = (connected: boolean) => setTelemetry((prev) => ({ ...prev, connected }));

    const connect = () => {
      const socket = new WebSocket(bridgeUrl());
      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        link.retry = link.stopped ? undefined : setTimeout(connect, RECONNECT_MS);
      };
      socket.onerror = () => socket.close();
      socket.onmessage = ({ data }: MessageEvent<string>) => {
        const msg = parse(data);
        if (msg) setTelemetry((prev) => applyMessage(prev, msg));
      };
      link.socket = socket;
    };

    connect();
    return () => {
      link.stopped = true;
      clearTimeout(link.retry);
      link.socket?.close();
    };
  }, []);

  return telemetry;
}
