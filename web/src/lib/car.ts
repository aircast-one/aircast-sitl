import {
  Cartesian3,
  ConstantPositionProperty,
  ConstantProperty,
  HeadingPitchRoll,
  HeightReference,
  Transforms,
  type Viewer,
} from "cesium";
import type { Car } from "@/hooks/useTelemetry.ts";
import { smoothCar } from "@/lib/pose.ts";

const MODEL_URL = "/models/car.glb";
const MODEL_HEADING = -Math.PI / 2;

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
  return { entity, drive };
}
