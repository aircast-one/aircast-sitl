import { Cartographic, type Viewer } from "cesium";
import type { Telemetry } from "@/hooks/useTelemetry.ts";

export interface Pose {
  lat: number;
  lng: number;
  alt: number;
  roll: number;
  pitch: number;
  yaw: number;
}

export const HOME_POSE: Pose = {
  lat: -35.363262,
  lng: 149.1652373,
  alt: 590,
  roll: 0,
  pitch: 0,
  yaw: 0,
};

const LERP = 0.1;
const GROUND_CLEARANCE_M = 0.5;

const lerp = (from: number, to: number) => from + (to - from) * LERP;

const wrapAngle = (a: number) =>
  a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a;

export function smoothPose(prev: Pose, t: Telemetry, viewer: Viewer): Pose {
  const hasFix = t.lat !== 0 || t.lng !== 0;
  const lat = hasFix ? lerp(prev.lat, t.lat) : prev.lat;
  const lng = hasFix ? lerp(prev.lng, t.lng) : prev.lng;
  const terrainHeight =
    viewer.scene.globe.getHeight(Cartographic.fromDegrees(lng, lat)) ?? 0;
  return {
    lat,
    lng,
    alt: lerp(prev.alt, terrainHeight + t.relativeAlt + GROUND_CLEARANCE_M),
    roll: lerp(prev.roll, t.roll),
    pitch: lerp(prev.pitch, t.pitch),
    yaw: prev.yaw + wrapAngle(t.yaw - prev.yaw) * LERP,
  };
}
