import { useEffect, useRef, useCallback } from "react";
import {
  Viewer,
  Ion,
  Cartesian3,
  Math as CesiumMath,
  Color,
  HeadingPitchRoll,
  Terrain,
  OpenStreetMapImageryProvider,
  UrlTemplateImageryProvider,
  Cesium3DTileset,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN || "";

export type MapLayer = "satellite" | "map";

const GOOGLE_PHOTOREALISTIC_ASSET = 2275207;

const SATELLITE_PROVIDER = new UrlTemplateImageryProvider({
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  credit: "Esri, Maxar, Earthstar Geographics",
  maximumLevel: 19,
});

const OSM_PROVIDER = new OpenStreetMapImageryProvider({
  url: "https://tile.openstreetmap.org/",
});

export function useCesiumViewer(
  containerRef: React.RefObject<HTMLDivElement | null>,
  { photorealistic = false }: { photorealistic?: boolean } = {},
) {
  const viewerRef = useRef<Viewer | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const viewer = new Viewer(container, {
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      navigationHelpButton: false,
      creditContainer: document.createElement("div"),
      msaaSamples: 4,
      baseLayer: false,
    });

    if (photorealistic) {
      viewer.scene.globe.show = false;
      Cesium3DTileset.fromIonAssetId(GOOGLE_PHOTOREALISTIC_ASSET)
        .then((tileset) => !viewer.isDestroyed() && viewer.scene.primitives.add(tileset))
        .catch((error) => console.error("Photorealistic 3D tiles failed to load", error));
    } else {
      viewer.scene.setTerrain(Terrain.fromWorldTerrain());
      viewer.imageryLayers.addImageryProvider(SATELLITE_PROVIDER);
    }

    viewer.scene.globe.enableLighting = true;
    if (viewer.scene.skyAtmosphere) {
      viewer.scene.skyAtmosphere.show = true;
    }
    viewer.scene.backgroundColor = Color.BLACK;

    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(149.1652373, -35.363262, 800),
      orientation: new HeadingPitchRoll(
        CesiumMath.toRadians(353),
        CesiumMath.toRadians(-30),
        0,
      ),
    });

    viewerRef.current = viewer;

    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [containerRef, photorealistic]);

  const setLayer = useCallback((layer: MapLayer) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(
      layer === "satellite" ? SATELLITE_PROVIDER : OSM_PROVIDER,
    );
  }, []);

  return { viewerRef, setLayer };
}
