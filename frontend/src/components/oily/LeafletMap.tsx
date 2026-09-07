import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LAYER_META, SENSITIVE_ZONES } from "@/lib/oily/data";
import { circle } from "@/lib/oily/geo";
import type { DriftPoint, Incident, RiskLevel } from "@/lib/oily/types";
import type { MapViewProps } from "./MapView";

const RISK_COLOR: Record<RiskLevel, string> = {
  LOW: "#15803d",
  MEDIUM: "#d97706",
  HIGH: "#ea580c",
  CRITICAL: "#dc2626",
};

function incidentIcon(incident: Incident, selected: boolean) {
  const color = RISK_COLOR[incident.risk];
  return L.divIcon({
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<span style="display:block;width:18px;height:18px;border-radius:9999px;background:${color};border:${
      selected ? "3px solid #1e293b" : "2px solid #ffffff"
    };box-shadow:0 0 0 4px ${color}33"></span>`,
  });
}

const TILE_THEMES: Record<
  NonNullable<MapViewProps["theme"]>,
  { url: string; attribution: string; className?: string; trajectoryColor: string; maxNativeZoom: number }
> = {
  // Standard OSM — no API key, general overview use (Dashboard, Incidents, History).
  default: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    trajectoryColor: "#0e7490",
    maxNativeZoom: 19,
  },
  // Esri World Ocean basemap — free, no key, bathymetry/terrain emphasis for Impact.
  // Esri's ocean service only serves tiles to zoom ~13; beyond that it returns
  // "Map data not yet available" placeholders. maxNativeZoom caps real requests
  // there and lets Leaflet upscale those tiles for deeper zoom instead.
  ocean: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "© Esri, GEBCO, NOAA, National Geographic",
    trajectoryColor: "#7c3aed",
    maxNativeZoom: 13,
  },
  // Same OSM tiles, inverted/tinted via CSS into a dark operational-tracking look for Drift.
  night: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    className: "oily-tiles-night",
    trajectoryColor: "#22d3ee",
    maxNativeZoom: 19,
  },
};

function featureIcon(color: string) {
  return L.divIcon({
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<span style="display:block;width:14px;height:14px;border-radius:3px;background:${color};border:2px solid #ffffff;box-shadow:0 0 0 2px ${color}55;transform:rotate(45deg)"></span>`,
  });
}

function waypointIcon(index: number, color: string, isNow: boolean) {
  return L.divIcon({
    className: "",
    iconSize: [isNow ? 22 : 18, isNow ? 22 : 18],
    iconAnchor: [isNow ? 11 : 9, isNow ? 11 : 9],
    html: `<span style="display:flex;align-items:center;justify-content:center;width:${isNow ? 22 : 18}px;height:${isNow ? 22 : 18}px;border-radius:9999px;background:${color};border:2px solid #ffffff;box-shadow:0 0 0 3px ${color}55;color:#fff;font:700 ${isNow ? 11 : 9}px/1 'IBM Plex Mono',monospace">${index}</span>`,
  });
}

function popupHtml(incident: Incident, extra?: { drift?: string; coast?: string }) {
  return `
  <div style="font-family:inherit;padding:10px 12px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <strong style="font-size:13px;letter-spacing:0.02em">${incident.id}</strong>
      <span style="font-size:10px;font-weight:700;color:${RISK_COLOR[incident.risk]}">${incident.risk} RISK</span>
    </div>
    <div style="font-size:11px;color:#64748b;margin-top:2px">${incident.name}</div>
    <div style="font-size:12px;margin-top:8px;display:grid;gap:2px">
      <div><span style="color:#64748b">Volume:</span> ${incident.volumeTonnes.toLocaleString()} t</div>
      <div><span style="color:#64748b">Area:</span> ${incident.spillAreaKm2} km²</div>
      ${extra?.drift ? `<div><span style="color:#64748b">Drift:</span> ${extra.drift}</div>` : ""}
      ${extra?.coast ? `<div><span style="color:#64748b">Coastline:</span> ${extra.coast}</div>` : ""}
    </div>
    <a href="/incidents/${incident.id}" style="display:block;margin-top:10px;text-align:center;background:#1d4ed8;color:#fff;font-size:11px;font-weight:600;padding:6px 8px;border-radius:4px;text-decoration:none">View Incident</a>
  </div>`;
}

export default function LeafletMap(props: MapViewProps) {
  const {
    incidents = [],
    selectedId,
    onSelect,
    trajectory,
    layers,
    showUncertainty = true,
    center,
    zoom = 8,
    interactive = true,
    spillFor,
    theme = "default",
  } = props;
  const tileTheme = TILE_THEMES[theme];
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const groupRef = useRef<L.LayerGroup | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  const activeLayers = useMemo(
    () =>
      layers ?? {
        coastline: true,
        mangrove: true,
        coral: true,
        mpa: true,
        fishing: true,
      },
    [layers],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: center ?? [21.1, 72.91],
      zoom,
      zoomControl: interactive,
      dragging: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      attributionControl: true,
    });
    L.tileLayer(tileTheme.url, {
      subdomains: "abc",
      maxZoom: 19,
      maxNativeZoom: tileTheme.maxNativeZoom,
      attribution: tileTheme.attribution,
      className: tileTheme.className,
    }).addTo(map);
    if (theme === "night") map.getContainer().classList.add("bg-navy");
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
    groupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      groupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = groupRef.current;
    if (!map || !group) return;
    group.clearLayers();

    // sensitive environmental layers
    for (const zone of SENSITIVE_ZONES) {
      if (!activeLayers[zone.layer]) continue;
      const meta = LAYER_META[zone.layer];
      const layer =
        zone.kind === "line"
          ? L.polyline(zone.path, { color: meta.color, weight: meta.weight, opacity: 0.9 })
          : L.polygon(zone.path, {
              color: meta.color,
              weight: meta.weight,
              fillColor: meta.color,
              fillOpacity: 0.14,
            });
      layer.bindTooltip(`${meta.label} — ${zone.name}`, { sticky: true });
      group.addLayer(layer);
    }

    // spill footprint
    if (spillFor) {
      const radius = Math.sqrt(spillFor.spillAreaKm2 / Math.PI);
      group.addLayer(
        L.polygon(circle(spillFor.lat, spillFor.lon, radius), {
          color: "#1e293b",
          weight: 1.5,
          fillColor: "#0f172a",
          fillOpacity: 0.35,
          dashArray: "3 3",
        }),
      );
    }

    // Uncertainty corridor polygon from the simulation engine (preferred over
    // per-waypoint circles): a single translucent envelope around the track.
    if (showUncertainty && props.uncertaintyPolygon && props.uncertaintyPolygon.length > 2) {
      group.addLayer(
        L.polygon(props.uncertaintyPolygon, {
          color: tileTheme.trajectoryColor,
          weight: 1,
          fillColor: tileTheme.trajectoryColor,
          fillOpacity: 0.1,
          dashArray: "4 4",
        }).bindTooltip("Modelled uncertainty envelope", { sticky: true }),
      );
    }

    // Dense per-timestep path from a stored simulation — the smooth central
    // predicted trajectory (solid), drawn under the coarse waypoint markers.
    if (props.densePath && props.densePath.length > 1) {
      group.addLayer(
        L.polyline(props.densePath, {
          color: tileTheme.trajectoryColor,
          weight: 3,
          opacity: 0.9,
        }),
      );
    }

    // Optional secondary (What-If scenario) path, dashed, for visual comparison.
    if (props.comparePath && props.comparePath.length > 1) {
      group.addLayer(
        L.polyline(props.comparePath, {
          color: "#f59e0b",
          weight: 2.5,
          opacity: 0.9,
          dashArray: "6 5",
        }).bindTooltip("What-If scenario", { sticky: true }),
      );
    }

    // trajectory — drawn as a labelled, numbered chain of waypoints (not just a
    // faint line) so the predicted path reads clearly at a glance.
    if (trajectory && trajectory.length > 1) {
      const path = trajectory.map((p) => [p.lat, p.lon] as [number, number]);
      // Only draw the coarse dashed connector when there's no dense path already.
      if (!props.densePath || props.densePath.length < 2) {
        group.addLayer(
          L.polyline(path, { color: tileTheme.trajectoryColor, weight: 3, opacity: 0.85, dashArray: "8 5" }),
        );
      }
      if (showUncertainty && !(props.uncertaintyPolygon && props.uncertaintyPolygon.length > 2)) {
        trajectory.slice(1).forEach((p: DriftPoint) => {
          group.addLayer(
            L.polygon(circle(p.lat, p.lon, p.uncertaintyKm), {
              color: tileTheme.trajectoryColor,
              weight: 1,
              fillColor: tileTheme.trajectoryColor,
              fillOpacity: 0.08,
            }),
          );
        });
      }
      trajectory.forEach((p: DriftPoint, i) => {
        const marker = L.marker([p.lat, p.lon], {
          icon: waypointIcon(i, tileTheme.trajectoryColor, p.hours === 0),
        }).bindTooltip(
          p.hours === 0
            ? "Now — spill origin"
            : `T+${p.hours}h · ${p.distanceKm.toFixed(1)} km travelled · ±${p.uncertaintyKm.toFixed(1)} km uncertainty`,
          { direction: "top", permanent: false },
        );
        group.addLayer(marker);
      });
    }

    if (props.marker) {
      group.addLayer(
        L.circleMarker([props.marker[0], props.marker[1]], {
          radius: 7,
          color: "#ffffff",
          weight: 2,
          fillColor: "#dc2626",
          fillOpacity: 1,
        }),
      );
    }

    // incidents
    for (const incident of incidents) {
      const marker = L.marker([incident.lat, incident.lon], {
        icon: incidentIcon(incident, incident.id === selectedId),
      });
      marker.bindPopup(popupHtml(incident, props.popupExtras?.[incident.id]));
      marker.on("click", () => selectRef.current?.(incident.id));
      group.addLayer(marker);
    }

    // arbitrary labelled features (e.g. real nearby sanctuaries/harbours) with
    // a connector line back to the spill so the spatial relationship is clear.
    const extraMarkers = props.extraMarkers ?? [];
    for (const f of extraMarkers) {
      const color = f.color ?? "#7c3aed";
      if (incidents.length === 1 && incidents[0]) {
        group.addLayer(
          L.polyline(
            [
              [incidents[0].lat, incidents[0].lon],
              [f.lat, f.lon],
            ],
            { color, weight: 1, opacity: 0.4, dashArray: "3 5" },
          ),
        );
      }
      group.addLayer(
        L.marker([f.lat, f.lon], { icon: featureIcon(color) }).bindTooltip(
          `<strong>${f.label}</strong>${f.sublabel ? `<br>${f.sublabel}` : ""}`,
          { direction: "top" },
        ),
      );
    }

    // viewport
    const focusPoints: [number, number][] = [
      ...(trajectory?.map((p) => [p.lat, p.lon] as [number, number]) ?? []),
      ...incidents
        .filter((i) => !selectedId || i.id === selectedId || incidents.length > 1)
        .map((i) => [i.lat, i.lon] as [number, number]),
      ...(props.fitToMarkers ? extraMarkers.map((f) => [f.lat, f.lon] as [number, number]) : []),
    ];
    const fitPath =
      props.densePath && props.densePath.length > 1
        ? props.densePath
        : trajectory && trajectory.length > 1
          ? trajectory.map((p) => [p.lat, p.lon] as [number, number])
          : null;
    if (props.fitToTrajectory && fitPath) {
      map.fitBounds(L.latLngBounds(fitPath), { padding: [50, 50] });
    } else if (center) {
      map.setView(center, zoom);
    } else if (focusPoints.length > 1) {
      map.fitBounds(L.latLngBounds(focusPoints), { padding: [40, 40] });
    } else if (focusPoints.length === 1) {
      map.setView(focusPoints[0]!, zoom);
    }
    setTimeout(() => map.invalidateSize(), 60);
  }, [
    incidents,
    selectedId,
    trajectory,
    activeLayers,
    showUncertainty,
    center,
    zoom,
    spillFor,
    tileTheme,
    props.marker,
    props.fitToTrajectory,
    props.popupExtras,
    props.extraMarkers,
    props.fitToMarkers,
    props.densePath,
    props.uncertaintyPolygon,
    props.comparePath,
  ]);

  return <div ref={containerRef} className="size-full" />;
}
