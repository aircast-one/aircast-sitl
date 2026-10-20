import {
  Cartesian3,
  Cartographic,
  ConstantPositionProperty,
  ConstantProperty,
  HeadingPitchRoll,
  HeightReference,
  Matrix4,
  SceneTransforms,
  Transforms,
  type Viewer,
} from "cesium";
import type { Car } from "@/hooks/useTelemetry.ts";
import { smoothCar } from "@/lib/pose.ts";

const MODEL_URL = "/models/car.glb";
const MODEL_HEADING = -Math.PI / 2;
const LENGTH_M = 4.87;
const WIDTH_M = 2.79;
const HEIGHT_M = 2.58;

export type Box = [number, number, number, number];

const corners = (heading: number) =>
  [-LENGTH_M / 2, LENGTH_M / 2].flatMap((along) =>
    [-WIDTH_M / 2, WIDTH_M / 2].flatMap((across) =>
      [0, HEIGHT_M].map(
        (up) =>
          new Cartesian3(
            along * Math.sin(heading) + across * Math.cos(heading),
            along * Math.cos(heading) - across * Math.sin(heading),
            up,
          ),
      ),
    ),
  );

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function addCar(viewer: Viewer) {
  const position = new ConstantPositionProperty();
  const orientation = new ConstantProperty();
  const entity = viewer.entities.add({
    show: false,
    position,
    orientation,
    model: { uri: MODEL_URL, heightReference: HeightReference.CLAMP_TO_GROUND },
  });
  const pose: { current: Car | null } = { current: null };
  const drive = (seen: Car | null) => {
    if (!seen) return;
    pose.current = smoothCar(pose.current, seen);
    const at = Cartesian3.fromDegrees(pose.current.lng, pose.current.lat);
    position.setValue(at);
    orientation.setValue(
      Transforms.headingPitchRollQuaternion(at, new HeadingPitchRoll(pose.current.heading + MODEL_HEADING, 0, 0)),
    );
    entity.show = true;
  };
  const box = (): Box | null => {
    const seen = pose.current;
    if (!seen || !entity.show) return null;
    const ground = viewer.scene.sampleHeight(Cartographic.fromDegrees(seen.lng, seen.lat), [entity]);
    if (ground === undefined) return null;
    const frame = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(seen.lng, seen.lat, ground));
    const onScreen = corners(seen.heading).map((corner) =>
      SceneTransforms.worldToWindowCoordinates(viewer.scene, Matrix4.multiplyByPoint(frame, corner, new Cartesian3())),
    );
    if (onScreen.some((point) => point === undefined)) return null;
    const { clientWidth, clientHeight } = viewer.canvas;
    const xs = onScreen.map((point) => point!.x / clientWidth);
    const ys = onScreen.map((point) => point!.y / clientHeight);
    const [left, top, right, bottom] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    return right <= 0 || bottom <= 0 || left >= 1 || top >= 1
      ? null
      : [clamp01(left), clamp01(top), clamp01(right), clamp01(bottom)];
  };
  return { entity, drive, box };
}
