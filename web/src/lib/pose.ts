import { Cartographic, Math as CesiumMath, sampleTerrainMostDetailed, type TerrainProvider, type Viewer } from "cesium";
import type { Car, Telemetry } from "@/hooks/useTelemetry.ts";

export interface Pose {
  lat: number;
  lng: number;
  alt: number;
  roll: number;
  pitch: number;
  yaw: number;
  aimHeading: number;
  aimPitch: number;
}

const FIXED_TILT = CesiumMath.toRadians(-15);

export const HOME_POSE: Pose = {
  lat: -35.363262,
  lng: 149.1652373,
  alt: 590,
  roll: 0,
  pitch: 0,
  yaw: 0,
  aimHeading: 0,
  aimPitch: FIXED_TILT,
};

const LERP = 0.1;
const SNAP_DEGREES = 0.01;
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
  (viewer: Viewer, exclude: object[] = []): HeightAt =>
  async (at) =>
    (await viewer.scene.sampleHeightMostDetailed([at], exclude))[0]?.height;

function sampledHeight(heightAt: HeightAt) {
  const cache = { key: "", height: undefined as number | undefined, due: 0 };
  return (lng: number, lat: number) => {
    const key = `${lat},${lng}`;
    const now = performance.now();
    if (key !== cache.key && now >= cache.due) {
      cache.key = key;
      cache.due = now + RESAMPLE_MS;
      const forget = () => Object.assign(cache, { key: "" });
      heightAt(Cartographic.fromDegrees(lng, lat))
        .then((height) => (height === undefined ? forget() : Object.assign(cache, { height })))
        .catch(forget);
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

export type Aim = (t: Telemetry) => { heading: number; pitch: number };

export const FPV_GIMBAL = 1;

export const gimbalAim =
  (device: number): Aim =>
  (t) => {
    const gimbal = t.gimbals[device];
    if (!gimbal) return { heading: t.yaw, pitch: FIXED_TILT };
    return { heading: gimbal.earthYaw ? gimbal.yaw : t.yaw + gimbal.yaw, pitch: gimbal.pitch };
  };

export function smoothPose(prev: Pose, t: Telemetry, altitude: Altitude, aim: Aim = gimbalAim(FPV_GIMBAL)): Pose {
  const hasFix = t.lat !== 0 || t.lng !== 0;
  const jumped = hasFix && Math.abs(t.lat - prev.lat) + Math.abs(t.lng - prev.lng) > SNAP_DEGREES;
  const follow = (from: number, to: number) => (jumped ? to : lerp(from, to));
  const lat = hasFix ? follow(prev.lat, t.lat) : prev.lat;
  const lng = hasFix ? follow(prev.lng, t.lng) : prev.lng;
  const target = altitude(lng, lat, t);
  const aimed = aim(t);
  return {
    lat,
    lng,
    alt: target === undefined ? prev.alt : follow(prev.alt, target),
    roll: lerp(prev.roll, t.roll),
    pitch: lerp(prev.pitch, t.pitch),
    yaw: prev.yaw + wrapAngle(t.yaw - prev.yaw) * LERP,
    aimHeading: prev.aimHeading + wrapAngle(aimed.heading - prev.aimHeading) * LERP,
    aimPitch: lerp(prev.aimPitch, aimed.pitch),
  };
}

export function smoothCar(prev: Car | null, car: Car): Car {
  const jumped = !prev || Math.abs(car.lat - prev.lat) + Math.abs(car.lng - prev.lng) > SNAP_DEGREES;
  return jumped
    ? car
    : {
        lat: lerp(prev.lat, car.lat),
        lng: lerp(prev.lng, car.lng),
        heading: prev.heading + wrapAngle(car.heading - prev.heading) * LERP,
      };
}
