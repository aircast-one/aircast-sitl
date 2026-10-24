import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Cartesian3, JulianDate, createWorldTerrainAsync } from "cesium";
import { bridgeUrl, useTelemetry } from "@/hooks/useTelemetry.ts";
import { useCesiumViewer } from "@/hooks/useCesiumViewer.ts";
import { Button } from "@/components/ui/button.tsx";
import { addCar } from "@/lib/car.ts";
import { FPV_GIMBAL, gimbalAim, HOME_POSE, homeAltitude, smoothPose, terrainHeight, tilesHeight } from "@/lib/pose.ts";
import { publishWhip } from "@/lib/whip.ts";

const FRAME_RATE = 30;
const SUPERSAMPLE = 1.5;
const BOX_REPORT_MS = 100;
const CAMERA_NAMES: Readonly<Record<number, string>> = { 1: "FPV camera", 2: "Payload camera" };

const solarNoon = (lng: number) =>
  JulianDate.addHours(
    JulianDate.fromIso8601(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`),
    -lng / 15,
    new JulianDate(),
  );

function reportCarBox(car: ReturnType<typeof addCar>) {
  const bridge = { current: new WebSocket(bridgeUrl()) };
  const reporting = setInterval(() => {
    if (bridge.current.readyState === WebSocket.CLOSED) bridge.current = new WebSocket(bridgeUrl());
    if (bridge.current.readyState === WebSocket.OPEN) {
      bridge.current.send(JSON.stringify({ type: "CAR_BOX", box: car.box() }));
    }
  }, BOX_REPORT_MS);
  return () => {
    clearInterval(reporting);
    bridge.current.close();
  };
}

export function CameraPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const telemetry = useTelemetry();
  const [params] = useSearchParams();
  const photorealistic = params.get("look") !== "satellite";
  const gimbal = Number(params.get("gimbal") ?? FPV_GIMBAL);
  const { viewerRef } = useCesiumViewer(containerRef, { photorealistic });
  const telemetryRef = useRef(telemetry);
  useEffect(() => {
    telemetryRef.current = telemetry;
  }, [telemetry]);
  const whipUrl = params.get("whip");

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    viewer.scene.screenSpaceCameraController.enableInputs = false;
    viewer.resolutionScale = SUPERSAMPLE;
    viewer.clock.shouldAnimate = false;
    viewer.clock.currentTime = solarNoon(HOME_POSE.lng);
    const pose = { current: HOME_POSE };
    const car = addCar(viewer);
    const altitude = homeAltitude(
      photorealistic ? tilesHeight(viewer, [car.entity]) : terrainHeight(createWorldTerrainAsync()),
    );

    const aim = gimbalAim(gimbal);
    const stopReporting = gimbal === FPV_GIMBAL ? reportCarBox(car) : () => undefined;

    const removeListener = viewer.scene.preRender.addEventListener(() => {
      pose.current = smoothPose(pose.current, telemetryRef.current, altitude, aim);
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(pose.current.lng, pose.current.lat, pose.current.alt),
        orientation: { heading: pose.current.aimHeading, pitch: pose.current.aimPitch, roll: 0 },
      });
      car.drive(telemetryRef.current.car);
    });
    return () => {
      removeListener();
      stopReporting();
    };
  }, [viewerRef, photorealistic, gimbal]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!whipUrl || !viewer || viewer.isDestroyed()) return;

    const [track] = viewer.canvas.captureStream(FRAME_RATE).getVideoTracks();
    const stop = publishWhip(track, whipUrl, SUPERSAMPLE);
    return () => {
      stop();
      track.stop();
    };
  }, [viewerRef, whipUrl]);

  const name = CAMERA_NAMES[gimbal] ?? `Gimbal ${gimbal} camera`;
  return (
    <>
      <title>{`${name} · Aircast SITL`}</title>
      <div ref={containerRef} className="w-[1280px] h-[720px] overflow-hidden bg-black" />
      <div className="fixed top-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2">
        <Button variant="outline" size="sm" className="bg-background/60 font-mono text-xs" asChild>
          <Link to="/">SITL Dashboard</Link>
        </Button>
        <p className="rounded-md bg-background/60 px-2.5 py-1.5 font-mono text-xs">
          {name} <span className="text-muted-foreground">· the frame streamed over RTSP and WHIP</span>
        </p>
      </div>
    </>
  );
}
