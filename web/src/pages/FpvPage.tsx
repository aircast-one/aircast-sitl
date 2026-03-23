import { useRef, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Cartesian3,
  Cartographic,
  HeadingPitchRoll,
  HeadingPitchRange,
  Math as CesiumMath,
  Transforms,
  CallbackProperty,
  Entity,
  Quaternion,
  Color,
  Cartesian2,
  LabelStyle,
} from "cesium";
import { useTelemetry } from "@/hooks/useTelemetry.ts";
import { useCesiumViewer, type MapLayer } from "@/hooks/useCesiumViewer.ts";
import { Hud } from "@/components/Hud.tsx";
import { Button } from "@/components/ui/button.tsx";

const LERP = 0.1;
const MODEL_URL = "/models/drone.glb";
const GROUND_CLEARANCE_M = 0.5;

export function FpvPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const telemetry = useTelemetry();
  const { viewerRef, setLayer } = useCesiumViewer(containerRef);
  const [layer, setLayerState] = useState<MapLayer>("satellite");
  const smoothRef = useRef({
    roll: 0,
    pitch: 0,
    yaw: 0,
    lat: -35.363262,
    lng: 149.1652373,
    alt: 590,
  });
  const entityRef = useRef<Entity | null>(null);
  const telemetryRef = useRef(telemetry);
  telemetryRef.current = telemetry;

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const s = smoothRef.current;

    const positionProperty = new CallbackProperty(() => {
      return Cartesian3.fromDegrees(s.lng, s.lat, s.alt);
    }, false);

    const orientationProperty = new CallbackProperty(() => {
      const heading = s.yaw >= 0 ? s.yaw : s.yaw + 2 * Math.PI;
      const hpr = new HeadingPitchRoll(heading, s.pitch, s.roll);
      const position = Cartesian3.fromDegrees(s.lng, s.lat, s.alt);
      return Transforms.headingPitchRollQuaternion(position, hpr);
    }, false) as unknown as CallbackProperty & Quaternion;

    const entity = viewer.entities.add({
      position: positionProperty as unknown as Cartesian3,
      orientation: orientationProperty,
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
    controller.minimumZoomDistance = 5;
    controller.maximumZoomDistance = 5000;

    // Initial camera offset
    let camHeading = 0;
    let camPitch = CesiumMath.toRadians(-30);
    let camRange = 50;
    let initialized = false;

    let animId: number;

    function animate() {
      animId = requestAnimationFrame(animate);
      if (!viewer || viewer.isDestroyed()) return;

      const t = telemetryRef.current;

      if (t.lat !== 0 || t.lng !== 0) {
        s.lat += (t.lat - s.lat) * LERP;
        s.lng += (t.lng - s.lng) * LERP;
      }
      // Use terrain height + AGL for correct altitude above terrain
      const terrainHeight =
        viewer.scene.globe.getHeight(
          Cartographic.fromDegrees(s.lng, s.lat),
        ) ?? 0;
      const targetAlt = terrainHeight + t.relativeAlt + GROUND_CLEARANCE_M;
      s.alt += (targetAlt - s.alt) * LERP;

      s.roll += (t.roll - s.roll) * LERP;
      s.pitch += (t.pitch - s.pitch) * LERP;

      let yawDiff = t.yaw - s.yaw;
      if (yawDiff > Math.PI) yawDiff -= 2 * Math.PI;
      if (yawDiff < -Math.PI) yawDiff += 2 * Math.PI;
      s.yaw += yawDiff * LERP;

      const position = Cartesian3.fromDegrees(s.lng, s.lat, s.alt);
      const transform = Transforms.eastNorthUpToFixedFrame(position);

      if (initialized) {
        // Preserve user's orbit offset (camera position is in local ENU frame after lookAtTransform)
        camHeading = viewer.camera.heading;
        camPitch = viewer.camera.pitch;
        camRange = Cartesian3.magnitude(
          Cartesian3.subtract(viewer.camera.positionWC, position, new Cartesian3()),
        );
      }

      viewer.camera.lookAtTransform(
        transform,
        new HeadingPitchRange(camHeading, camPitch, camRange),
      );
      initialized = true;
    }

    animate();

    return () => {
      cancelAnimationFrame(animId);
      if (!viewer.isDestroyed()) {
        // Unlock camera from transform
        viewer.camera.lookAtTransform(Transforms.eastNorthUpToFixedFrame(
          Cartesian3.fromDegrees(s.lng, s.lat, s.alt),
        ));
        viewer.entities.remove(entity);
      }
      entityRef.current = null;
    };
  }, [viewerRef]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      <div ref={containerRef} className="w-full h-full" />

      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-20 flex gap-2">
        <Button variant="outline" size="sm" className="bg-background/60 font-mono text-xs" asChild>
          <Link to="/">SITL Dashboard</Link>
        </Button>
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
      </div>

      <Hud telemetry={telemetry} />
    </div>
  );
}
