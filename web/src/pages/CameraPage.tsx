import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Cartesian3, Math as CesiumMath } from "cesium";
import { useTelemetry } from "@/hooks/useTelemetry.ts";
import { useCesiumViewer } from "@/hooks/useCesiumViewer.ts";
import { HOME_POSE, smoothPose } from "@/lib/pose.ts";
import { publishWhip } from "@/lib/whip.ts";

const GIMBAL_TILT = CesiumMath.toRadians(-15);
const FRAME_RATE = 30;

export function CameraPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const telemetry = useTelemetry();
  const { viewerRef } = useCesiumViewer(containerRef);
  const telemetryRef = useRef(telemetry);
  useEffect(() => {
    telemetryRef.current = telemetry;
  }, [telemetry]);
  const whipUrl = useSearchParams()[0].get("whip");

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    viewer.scene.screenSpaceCameraController.enableInputs = false;
    const pose = { current: HOME_POSE };

    return viewer.scene.preRender.addEventListener(() => {
      pose.current = smoothPose(pose.current, telemetryRef.current, viewer);
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(pose.current.lng, pose.current.lat, pose.current.alt),
        orientation: { heading: pose.current.yaw, pitch: GIMBAL_TILT, roll: 0 },
      });
    });
  }, [viewerRef]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!whipUrl || !viewer || viewer.isDestroyed()) return;

    const [track] = viewer.canvas.captureStream(FRAME_RATE).getVideoTracks();
    const stop = publishWhip(track, whipUrl);
    return () => {
      stop();
      track.stop();
    };
  }, [viewerRef, whipUrl]);

  return <div ref={containerRef} className="w-[1280px] h-[720px] overflow-hidden bg-black" />;
}
