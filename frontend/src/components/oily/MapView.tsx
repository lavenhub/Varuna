import { ClientOnly } from "@tanstack/react-router";
import { Suspense, lazy } from "react";
import { cn } from "@/lib/utils";
import { LAYER_META, type SensitiveZone } from "@/lib/oily/data";
import type { DriftPoint, Incident } from "@/lib/oily/types";

const LeafletMap = lazy(() => import("./LeafletMap"));

export type LayerToggles = Record<SensitiveZone["layer"], boolean>;

/**
 * Visual theme per page, so every tab doesn't look identical:
 * - "default"  — standard light OSM basemap (Dashboard, Incidents, History)
 * - "ocean"    — Esri World Ocean basemap, bathymetry/terrain emphasis (Impact)
 * - "night"    — dark operational-tracking look via CSS filter over OSM tiles,
 *                glowing cyan trajectory (Drift)
 */
export type MapTheme = "default" | "ocean" | "night";

export interface MapViewProps {
  incidents?: Incident[];
  selectedId?: string | undefined;
  onSelect?: ((id: string) => void) | undefined;
  trajectory?: DriftPoint[] | undefined;
  /** Dense per-timestep path (from a stored simulation) drawn as a smooth line. */
  densePath?: [number, number][] | undefined;
  /** Uncertainty corridor polygon (lat/lon ring) from the simulation engine. */
  uncertaintyPolygon?: [number, number][] | undefined;
  /** Optional secondary path (e.g. a What-If scenario) drawn dashed for compare. */
  comparePath?: [number, number][] | undefined;
  spillFor?: Incident | undefined;
  layers?: LayerToggles | undefined;
  showUncertainty?: boolean;
  center?: [number, number] | undefined;
  zoom?: number;
  interactive?: boolean;
  marker?: [number, number] | undefined;
  fitToTrajectory?: boolean;
  popupExtras?: Record<string, { drift?: string; coast?: string }> | undefined;
  theme?: MapTheme;
  /** Arbitrary labelled points (e.g. real nearby sanctuaries/harbours on the Impact map). */
  extraMarkers?:
    | { lat: number; lon: number; label: string; sublabel?: string; color?: string }[]
    | undefined;
  /** Include extraMarkers in the auto-fit bounds so they're all visible. */
  fitToMarkers?: boolean;
}

function MapSkeleton() {
  return (
    <div className="flex size-full items-center justify-center bg-accent/40">
      <span className="label-caps">Loading basemap…</span>
    </div>
  );
}

export function MapView({
  className,
  ...props
}: MapViewProps & { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-md border border-border bg-accent/40", className)}>
      <ClientOnly fallback={<MapSkeleton />}>
        <Suspense fallback={<MapSkeleton />}>
          <LeafletMap {...props} />
        </Suspense>
      </ClientOnly>
    </div>
  );
}

export const DEFAULT_LAYERS: LayerToggles = {
  coastline: true,
  mangrove: true,
  coral: true,
  mpa: true,
  fishing: true,
};

export function LayerLegend({
  layers,
  onToggle,
  showSpillRows = true,
}: {
  layers: LayerToggles;
  onToggle: (layer: SensitiveZone["layer"]) => void;
  showSpillRows?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {showSpillRows ? (
        <>
          <div className="flex items-center gap-2 text-sm">
            <span className="size-3 rounded-sm border border-foreground/70 bg-foreground/40" />
            Spill footprint
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="h-0.5 w-3 bg-cyan" />
            Predicted trajectory
          </div>
        </>
      ) : null}
      {(Object.keys(LAYER_META) as SensitiveZone["layer"][]).map((key) => (
        <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={layers[key]}
            onChange={() => onToggle(key)}
            className="size-3.5 accent-[var(--primary)]"
          />
          <span className="size-3 rounded-sm" style={{ background: LAYER_META[key].color }} />
          {LAYER_META[key].label}
        </label>
      ))}
    </div>
  );
}
