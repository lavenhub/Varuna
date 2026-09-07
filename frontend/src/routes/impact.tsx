import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, MapPin } from "lucide-react";
import { AppShell } from "@/components/oily/AppShell";
import { MapView, DEFAULT_LAYERS } from "@/components/oily/MapView";
import { AnalysisSteps } from "@/components/oily/AnalysisSteps";
import { IncidentSelector, IncidentSummaryStrip } from "@/components/oily/IncidentSelector";
import {
  AuditPanel,
  Bar,
  DataRow,
  Disclaimer,
  ModelBadge,
  PageHeader,
  Panel,
  QualityBadge,
  RiskBadge,
  ScoreGauge,
} from "@/components/oily/primitives";
import { oilyStore, useIncident } from "@/lib/oily/store";
import { formatCoord } from "@/lib/oily/geo";
import { oily, type ImpactResult } from "@/api";
import type { NearbyFeature, NearbyResponse } from "@/services/oilyApi";
import { DISCLAIMERS } from "@/lib/oily/data";
import type { Incident } from "@/lib/oily/types";

export const Route = createFileRoute("/impact")({
  validateSearch: (search: Record<string, unknown>): { incident?: string } => {
    const incident = typeof search["incident"] === "string" ? (search["incident"] as string) : undefined;
    return incident ? { incident } : {};
  },
  head: () => ({
    meta: [
      { title: "Environmental Impact — Varuna Spill Intelligence" },
      {
        name: "description",
        content:
          "Model-backed environmental severity scoring (trained on NOAA incident data) with a transparent factor decomposition and full audit trail.",
      },
    ],
  }),
  component: ImpactPage,
});

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "var(--critical)",
  HIGH: "var(--warning)",
  MEDIUM: "var(--caution)",
  LOW: "var(--safe)",
};

type Async<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: T }
  | { status: "error"; message: string };

function useAsync<T>(incident: Incident | undefined, run: (inc: Incident) => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<Async<T>>({ status: "idle" });
  useEffect(() => {
    if (!incident) return;
    let cancelled = false;
    setState({ status: "loading" });
    run(incident)
      .then((data) => !cancelled && setState({ status: "ok", data }))
      .catch((err: unknown) =>
        !cancelled && setState({ status: "error", message: err instanceof Error ? err.message : String(err) }),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incident, ...deps]);
  return state;
}

const FEATURE_META: Record<NearbyFeature["category"], { label: string; color: string }> = {
  fishing_harbour: { label: "Fishing harbour / port", color: "#0e7490" },
  protected_area: { label: "Protected area / sanctuary", color: "#7c3aed" },
  mangrove: { label: "Mangrove wetland", color: "#15803d" },
  coral_reef: { label: "Coral reef", color: "#c2410c" },
};

const IMPACT_STEPS = [
  "Resolving exact coordinates & distance to coast",
  "Running the drift simulation for exposure timing",
  "Scoring with the NOAA-trained environmental model",
  "Decomposing the score into explainable factors",
];

function ImpactPage() {
  const { incident: incidentId } = Route.useSearch();
  const navigate = useNavigate();
  const incident = useIncident(incidentId);
  const [sel, setSel] = useState<string | undefined>(incidentId);

  const impact = useAsync<ImpactResult>(incident, (inc) => oily.impact.calculate(inc.id, false));
  // Nearby ecological features (map + list) — a dedicated call so a slow/failed
  // OpenStreetMap lookup never blocks the impact score.
  const nearbyState = useNearbyFeatures(incident);

  const analysing = impact.status === "loading" || impact.status === "idle";
  const [analysisStep, setAnalysisStep] = useState(0);
  useEffect(() => {
    if (!analysing) {
      setAnalysisStep(IMPACT_STEPS.length);
      return;
    }
    setAnalysisStep(0);
    const id = setInterval(() => setAnalysisStep((s) => Math.min(s + 1, IMPACT_STEPS.length - 1)), 500);
    return () => clearInterval(id);
  }, [analysing, incident]);

  useEffect(() => {
    if (incident && impact.status === "ok") {
      oilyStore.recordAnalysis({
        incidentId: incident.id,
        incidentName: incident.name,
        kind: "impact",
        summary: `Impact ${impact.data.score}/100 (${impact.data.severity})`,
        detail: `${impact.data.factors.length} factors · ${impact.data.modelBacking.available ? "model-backed" : "heuristic"}`,
      });
    }
  }, [incident, impact]);

  if (!incident) {
    return (
      <AppShell>
        <PageHeader
          title="Environmental Impact"
          subtitle="Select an incident to assess environmental severity and ecological exposure."
        />
        <IncidentSelector
          selectedId={sel}
          onSelect={setSel}
          ctaLabel="Assess Impact"
          onConfirm={() => sel && navigate({ to: "/impact", search: { incident: sel } })}
        />
        <Disclaimer>{DISCLAIMERS.impact}</Disclaimer>
      </AppShell>
    );
  }

  const result = impact.status === "ok" ? impact.data : null;
  const severity = result?.severity ?? incident.risk;
  const score = result?.score ?? 0;
  const marker: [number, number] = [incident.lat, incident.lon];

  return (
    <AppShell>
      <PageHeader
        title="Environmental Impact"
        subtitle={`${incident.id} — ${incident.name}`}
        badges={
          <div className="flex items-center gap-2">
            <RiskBadge level={severity} />
            <QualityBadge quality="ESTIMATED" />
            {result ? <ModelBadge version={result.modelVersion} label="Impact composition" /> : null}
          </div>
        }
        action={
          <button
            onClick={() => navigate({ to: "/impact", search: {} })}
            className="rounded-sm border border-border-strong px-4 py-2.5 text-sm font-semibold uppercase tracking-wide hover:bg-accent"
          >
            Change incident
          </button>
        }
      />

      <IncidentSummaryStrip incident={incident} />

      {analysing ? (
        <AnalysisSteps steps={IMPACT_STEPS} activeStep={analysisStep} title="Assessing environmental impact" />
      ) : null}

      {impact.status === "error" ? (
        <Disclaimer>
          Impact model unreachable ({impact.message}). Start the VARUNA backend with
          ".venv311\Scripts\python.exe scripts\run_api.py".
        </Disclaimer>
      ) : null}

      {result ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <Panel
              title="Severity Assessment"
              action={<QualityBadge quality="ESTIMATED" title="Estimated environmental exposure / severity — not a measurement of ecological damage" />}
            >
              <ScoreGauge score={score} severity={severity} confidence={Math.round(result.confidence * 100)} />
              <p className="mt-3 text-[12px] text-muted-foreground">
                Estimated Environmental Exposure / Severity — a model-based estimate, not a measurement
                of ecological damage.
              </p>

              <h3 className="label-caps mt-5 mb-2">Factor Decomposition</h3>
              <div className="space-y-3">
                {result.factors.map((f) => (
                  <div key={f.name}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span>{f.name}</span>
                      <span className="num font-semibold">{Math.round(f.contribution * 100)}%</span>
                    </div>
                    <Bar value={f.contribution * 100} tone={SEVERITY_COLOR[severity] ?? "var(--primary)"} />
                    <p className="mt-1 text-[11px] text-muted-foreground">{f.reason}</p>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title={`Why is this ${severity}?`} dense>
              <ul className="space-y-2">
                {result.reasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-warning" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Auditability — where this score comes from" dense>
              <AuditPanel
                inputs={[
                  { label: "Volume", value: `${incident.volumeTonnes.toLocaleString()} t` },
                  { label: "Spill area", value: `${incident.spillAreaKm2} km²` },
                  { label: "Persistence", value: incident.persistence },
                  { label: "Distance to coast", value: result.inputs["distanceToCoastKm"] != null ? `${result.inputs["distanceToCoastKm"]} km` : "—" },
                  { label: "Coastline exposure", value: result.inputs["coastlineExposureHours"] != null ? `${result.inputs["coastlineExposureHours"]} h` : "—" },
                ]}
                model={
                  <>
                    <ModelBadge version={result.modelBacking.available ? "impact-model-v1" : "heuristic-fallback"} />
                    <p className="text-muted-foreground">{result.modelBacking.scoreModel}</p>
                    {result.modelBacking.available ? (
                      <p className="text-muted-foreground">
                        Held-out R² {result.modelBacking.testR2?.toFixed(3)} · MAE{" "}
                        {result.modelBacking.testMae?.toFixed(2)} · {result.modelBacking.trainingRows} rows
                      </p>
                    ) : (
                      <p className="text-warning">Real model unavailable — transparent heuristic used</p>
                    )}
                  </>
                }
                output={[
                  { label: "Score", value: `${result.score} / 100` },
                  { label: "Severity", value: severity },
                  { label: "Confidence", value: `${Math.round(result.confidence * 100)}%` },
                ]}
              />
            </Panel>

            <Panel
              title="Precise Spill Location & Nearest Sensitive Features"
              action={
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <MapPin className="size-3.5 text-critical" /> Exact coordinates · real OSM features
                </span>
              }
              bodyClassName="p-0"
            >
              <MapView
                className="h-[420px] rounded-none border-0"
                theme="ocean"
                incidents={[incident]}
                selectedId={incident.id}
                spillFor={incident}
                marker={marker}
                layers={DEFAULT_LAYERS}
                extraMarkers={
                  nearbyState.status === "ok"
                    ? nearbyState.data.features.map((f) => ({
                        lat: f.lat,
                        lon: f.lon,
                        label: f.name,
                        sublabel: `${FEATURE_META[f.category].label} · ${f.distanceKm} km ${f.bearing}`,
                        color: FEATURE_META[f.category].color,
                      }))
                    : undefined
                }
                fitToMarkers
              />
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Exact Coordinates" dense>
              <DataRow label="Latitude" value={<span className="num">{incident.lat.toFixed(4)}°</span>} />
              <DataRow label="Longitude" value={<span className="num">{incident.lon.toFixed(4)}°</span>} />
              <DataRow label="Formatted" value={<span className="num text-xs">{formatCoord(incident.lat, incident.lon)}</span>} />
              <DataRow
                label="Distance to coast"
                value={result.inputs["distanceToCoastKm"] != null ? `${result.inputs["distanceToCoastKm"]} km` : "—"}
              />
              <DataRow label="Location type" value={result.inputs["isOceanPoint"] ? "Open water" : "Coastal / inland source"} />
            </Panel>

            <Panel title="Ecological Exposure" dense>
              <ul className="space-y-2">
                {result.exposures.map((e, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-sm">
                    <span>{e.feature}{e.name ? ` — ${e.name}` : ""}</span>
                    <span className="num flex items-center gap-2 text-xs">
                      {e.hours != null ? `${e.hours} h` : e.distanceKm != null ? `${e.distanceKm} km` : "n/a"}
                      <RiskBadge level={e.severity} />
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel
              title="Nearest Affected Features"
              action={nearbyState.status === "loading" ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
              dense
            >
              {nearbyState.status === "ok" && nearbyState.data.features.length > 0 ? (
                <ul className="space-y-2">
                  {nearbyState.data.features.map((f) => (
                    <li key={`${f.category}-${f.name}`} className="flex items-start justify-between gap-2 text-sm">
                      <span className="flex items-start gap-2">
                        <span className="mt-1 size-2.5 shrink-0 rotate-45 rounded-sm" style={{ background: FEATURE_META[f.category].color }} />
                        <span>
                          <span className="block">{f.name}</span>
                          <span className="block text-[11px] text-muted-foreground">{FEATURE_META[f.category].label}</span>
                        </span>
                      </span>
                      <span className="num shrink-0 text-right text-xs">
                        {f.distanceKm} km<span className="block text-[10px] text-muted-foreground">{f.bearing}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : nearbyState.status === "ok" ? (
                <p className="py-2 text-[13px] text-muted-foreground">No mapped features within 90 km in OpenStreetMap.</p>
              ) : nearbyState.status === "error" ? (
                <p className="py-2 text-[13px] text-muted-foreground">Nearby-features lookup unavailable.</p>
              ) : (
                <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Querying OpenStreetMap…
                </div>
              )}
            </Panel>

            <Panel title="Model & Data Sources" dense>
              <DataRow label="Score model" value={result.modelBacking.available ? "NOAA-trained regressor" : "Heuristic fallback"} />
              {result.modelBacking.available ? (
                <>
                  <DataRow label="Held-out R²" value={result.modelBacking.testR2?.toFixed(3) ?? "—"} />
                  <DataRow label="Held-out MAE" value={result.modelBacking.testMae != null ? `${result.modelBacking.testMae.toFixed(2)} pts` : "—"} />
                  <DataRow label="Training rows" value={result.modelBacking.trainingRows ?? "—"} />
                </>
              ) : null}
              <DataRow label="Distance to coast" value="global-land-mask raster" />
              <DataRow label="Exposure timing" value="varuna-drift-v1 simulation" />
              <DataRow label="Nearby features" value="OpenStreetMap Overpass" />
            </Panel>

            <Disclaimer>{DISCLAIMERS.impact}</Disclaimer>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

// --- dedicated nearby-features hook (kept separate so a slow/failed OSM lookup
// never blocks the impact score) ------------------------------------------------
function useNearbyFeatures(incident: Incident | undefined): Async<NearbyResponse> {
  const [state, setState] = useState<Async<NearbyResponse>>({ status: "idle" });
  useEffect(() => {
    if (!incident) return;
    let cancelled = false;
    setState({ status: "loading" });
    import("@/lib/oily/api.functions")
      .then(({ nearbyFeaturesFn }) => nearbyFeaturesFn({ data: { latitude: incident.lat, longitude: incident.lon } }))
      .then((data) => !cancelled && setState({ status: "ok", data: data as NearbyResponse }))
      .catch((err: unknown) => !cancelled && setState({ status: "error", message: String(err) }));
    return () => {
      cancelled = true;
    };
  }, [incident]);
  return state;
}
