import { Cartographic, sampleTerrainMostDetailed, type TerrainProvider, type Viewer } from "cesium";
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

export type Altitude = (lng: number, lat: number, t: Telemetry) => number | undefined;
export type HeightAt = (at: Cartographic) => Promise<number | undefined>;

const RESAMPLE_MS = 1000;

export const terrainFollowing =
  (viewer: Viewer): Altitude =>
  (lng, lat, t) => {
    const ground = viewer.scene.globe.getHeight(Cartographic.fromDegrees(lng, lat));
    return ground === undefined ? undefined : ground + t.relativeAlt + GROUND_CLEARANCE_M;
  };

export const terrainHeight =
  (terrain: Promise<TerrainProvider>): HeightAt =>
  async (at) =>
    (await sampleTerrainMostDetailed(await terrain, [at]))[0]?.height;

export const tilesHeight =
  (viewer: Viewer): HeightAt =>
  async (at) =>
    (await viewer.scene.sampleHeightMostDetailed([at]))[0]?.height;

function sampledHeight(heightAt: HeightAt) {
  const cache = { key: "", height: undefined as number | undefined, due: 0 };
  return (lng: number, lat: number) => {
    const key = `${lat},${lng}`;
    const now = performance.now();
    if (key !== cache.key && now >= cache.due) {
      cache.key = key;
      cache.due = now + RESAMPLE_MS;
      heightAt(Cartographic.fromDegrees(lng, lat))
        .catch(() => undefined)
        .then((height) => {
          if (height === undefined) cache.key = "";
          else cache.height = height;
        });
    }
    return cache.height;
  };
}

export function homeAltitude(heightAt: HeightAt): Altitude {
  const home = sampledHeight(heightAt);
  const below = sampledHeight(heightAt);
  return (lng, lat, t) => {
    const atHome = t.homeSet ? home(t.homeLng, t.homeLat) : home(HOME_POSE.lng, HOME_POSE.lat);
    const underDrone = below(lng, lat);
    return atHome === undefined || underDrone === undefined
      ? undefined
      : Math.max(atHome + t.relativeAlt, underDrone) + GROUND_CLEARANCE_M;
  };
}

export function smoothPose(prev: Pose, t: Telemetry, altitude: Altitude): Pose {
  const hasFix = t.lat !== 0 || t.lng !== 0;
  const lat = hasFix ? lerp(prev.lat, t.lat) : prev.lat;
  const lng = hasFix ? lerp(prev.lng, t.lng) : prev.lng;
  const target = altitude(lng, lat, t);
  return {
    lat,
    lng,
    alt: target === undefined ? prev.alt : lerp(prev.alt, target),
    roll: lerp(prev.roll, t.roll),
    pitch: lerp(prev.pitch, t.pitch),
    yaw: prev.yaw + wrapAngle(t.yaw - prev.yaw) * LERP,
  };
}
