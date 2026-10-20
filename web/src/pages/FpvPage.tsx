import { useRef, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Cartesian3,
  ConstantPositionProperty,
  ConstantProperty,
  HeadingPitchRoll,
  HeadingPitchRange,
  Math as CesiumMath,
  Transforms,
  Entity,
  Color,
  Cartesian2,
  LabelStyle,
} from "cesium";
import { useTelemetry } from "@/hooks/useTelemetry.ts";
import { useCesiumViewer, type MapLayer } from "@/hooks/useCesiumViewer.ts";
import { Hud } from "@/components/Hud.tsx";
import { Button } from "@/components/ui/button.tsx";
import { addCar } from "@/lib/car.ts";
import { HOME_POSE, homeAltitude, smoothPose, terrainFollowing, tilesHeight, type Pose } from "@/lib/pose.ts";

const MODEL_URL = "/models/drone.glb";
const NEAREST_M = 5;
const FARTHEST_M = 5000;
const DRAGGED_RAD = 0.002;

export function FpvPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const telemetry = useTelemetry();
  const [params] = useSearchParams();
  const photorealistic = params.get("look") !== "satellite";
  const { viewerRef, setLayer } = useCesiumViewer(containerRef, { photorealistic });
  const [layer, setLayerState] = useState<MapLayer>("satellite");
  const poseRef = useRef<Pose>(HOME_POSE);
  const entityRef = useRef<Entity | null>(null);
  const telemetryRef = useRef(telemetry);
  useEffect(() => {
    telemetryRef.current = telemetry;
  }, [telemetry]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const home = poseRef.current;
    const initialPos = Cartesian3.fromDegrees(home.lng, home.lat, home.alt);
    const positionProp = new ConstantPositionProperty(initialPos);
    const orientationProp = new ConstantProperty(
      Transforms.headingPitchRollQuaternion(initialPos, new HeadingPitchRoll(0, 0, 0)),
    );
    const entity = viewer.entities.add({
      position: positionProp as unknown as Cartesian3,
      orientation: orientationProp,
      model: {
        uri: MODEL_URL,
        minimumPixelSize: 64,
        maximumScale: 20,
      },
      label: {
        text: "DRONE",
        font: "12px monospace",
        fillColor: Color.fromCssColorString("#00ff66"),
        pixelOffset: new Cartesian2(0, -40),
        style: LabelStyle.FILL_AND_OUTLINE,
        outlineWidth: 2,
        outlineColor: Color.fromAlpha(Color.BLACK, 0.8),
      },
    });

    entityRef.current = entity;

    const controller = viewer.scene.screenSpaceCameraController;
    controller.minimumZoomDistance = NEAREST_M;
    controller.maximumZoomDistance = FARTHEST_M;
    const car = addCar(viewer);
    const altitude = photorealistic ? homeAltitude(tilesHeight(viewer, [entity, car.entity])) : terrainFollowing(viewer);

    let behind = 0;
    let aimedAt = initialPos;
    let camHeading = 0;
    let camPitch = CesiumMath.toRadians(-30);
    let camRange = 50;
    let initialized = false;

    let animId: number;

    function animate() {
      animId = requestAnimationFrame(animate);
      if (!viewer || viewer.isDestroyed()) return;

      const s = smoothPose(poseRef.current, telemetryRef.current, altitude);
      poseRef.current = s;
      car.drive(telemetryRef.current.car);

      const position = Cartesian3.fromDegrees(s.lng, s.lat, s.alt);

      const heading = s.yaw >= 0 ? s.yaw : s.yaw + 2 * Math.PI;
      const hpr = new HeadingPitchRoll(heading, s.pitch, s.roll);
      positionProp.setValue(position);
      orientationProp.setValue(Transforms.headingPitchRollQuaternion(position, hpr));

      const transform = Transforms.eastNorthUpToFixedFrame(position);

      if (initialized) {
        const dragged = CesiumMath.negativePiToPi(viewer.camera.heading - camHeading);
        behind = Math.abs(dragged) > DRAGGED_RAD ? behind + dragged : behind;
        camPitch = viewer.camera.pitch;
        camRange = CesiumMath.clamp(
          Cartesian3.magnitude(Cartesian3.subtract(viewer.camera.positionWC, aimedAt, new Cartesian3())),
          NEAREST_M,
          FARTHEST_M,
        );
      }
      camHeading = heading + behind;

      viewer.camera.lookAtTransform(
        transform,
        new HeadingPitchRange(camHeading, camPitch, camRange),
      );
      aimedAt = position;
      initialized = true;
    }

    animate();

    return () => {
      cancelAnimationFrame(animId);
      if (!viewer.isDestroyed()) {
        const last = poseRef.current;
        viewer.camera.lookAtTransform(Transforms.eastNorthUpToFixedFrame(
          Cartesian3.fromDegrees(last.lng, last.lat, last.alt),
        ));
        viewer.entities.remove(entity);
        viewer.entities.remove(car.entity);
      }
      entityRef.current = null;
    };
  }, [viewerRef, photorealistic]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      <div ref={containerRef} className="w-full h-full" />

      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-20 flex gap-2">
        <Button variant="outline" size="sm" className="bg-background/60 font-mono text-xs" asChild>
          <Link to="/">SITL Dashboard</Link>
        </Button>
        {!photorealistic && (
          <Button
            variant="outline"
            size="sm"
            className="bg-background/60 font-mono text-xs"
            onClick={() => {
              const next = layer === "satellite" ? "map" : "satellite";
              setLayer(next);
              setLayerState(next);
            }}
          >
            {layer === "satellite" ? "MAP" : "SAT"}
          </Button>
        )}
      </div>

      <Hud telemetry={telemetry} />
    </div>
  );
}
