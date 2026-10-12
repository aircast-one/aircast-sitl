import { useEffect, useRef } from "react";
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ConstantPositionProperty,
  Entity,
  Ion,
  Math as CesiumMath,
  Rectangle,
  SceneMode,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer,
  WebMercatorProjection,
} from "cesium";
import { SATELLITE_PROVIDER } from "@/hooks/useCesiumViewer.ts";

export interface LatLng {
  lat: number;
  lng: number;
}

const VIEW_HEIGHT_M = 4000;

const marker = (color: Color, size: number) =>
  new Entity({ show: false, point: { pixelSize: size, color, outlineColor: Color.WHITE, outlineWidth: 2 } });

const place = (entity: Entity, at: LatLng | null) => {
  entity.show = at !== null;
  if (at) entity.position = new ConstantPositionProperty(Cartesian3.fromDegrees(at.lng, at.lat));
};

const viewRectangle = (viewer: Viewer) => {
  const { clientWidth, clientHeight } = viewer.scene.canvas;
  const corners = [new Cartesian2(0, clientHeight), new Cartesian2(clientWidth, 0)].map((corner) => viewer.camera.pickEllipsoid(corner));
  return corners.every((corner) => corner !== undefined) ? Rectangle.fromCartesianArray(corners as Cartesian3[]) : undefined;
};

export function LocationMap({ home, pick, onPick }: { home: LatLng | null; pick: LatLng | null; onPick: (at: LatLng) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const markersRef = useRef({ home: marker(Color.fromCssColorString("#8a8f98"), 10), pick: marker(Color.fromCssColorString("#3b82f6"), 14) });
  const onPickRef = useRef(onPick);
  const centeredRef = useRef(false);

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewer = new Viewer(container, {
      sceneMode: SceneMode.SCENE2D,
      mapProjection: new WebMercatorProjection(),
      baseLayer: false,
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: Ion.defaultAccessToken !== "",
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      navigationHelpButton: false,
      requestRenderMode: true,
      creditContainer: document.createElement("div"),
    });
    viewer.imageryLayers.addImageryProvider(SATELLITE_PROVIDER);
    viewer.entities.add(markersRef.current.home);
    viewer.entities.add(markersRef.current.pick);

    const clicks = new ScreenSpaceEventHandler(viewer.scene.canvas);
    clicks.setInputAction(({ position }: ScreenSpaceEventHandler.PositionedEvent) => {
      const hit = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
      if (!hit) return;
      const at = Cartographic.fromCartesian(hit);
      onPickRef.current({ lat: CesiumMath.toDegrees(at.latitude), lng: CesiumMath.toDegrees(at.longitude) });
    }, ScreenSpaceEventType.LEFT_CLICK);

    viewerRef.current = viewer;
    return () => {
      clicks.destroy();
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    place(markersRef.current.home, home);
    place(markersRef.current.pick, pick);

    const target = pick ?? home;
    const view = viewRectangle(viewer);
    const visible = target && (!view || Rectangle.contains(view, Cartographic.fromDegrees(target.lng, target.lat)));
    if (target && (!centeredRef.current || !visible)) {
      viewer.camera.setView({ destination: Cartesian3.fromDegrees(target.lng, target.lat, VIEW_HEIGHT_M) });
      centeredRef.current = true;
    }
    viewer.scene.requestRender();
  }, [home, pick]);

  return <div ref={containerRef} className="size-full" />;
}
