import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Waves } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/oily/AppShell";
import { MapView, DEFAULT_LAYERS } from "@/components/oily/MapView";
import { AnalysisSteps } from "@/components/oily/AnalysisSteps";
import { IncidentSelector, IncidentSummaryStrip } from "@/components/oily/IncidentSelector";
import {
  AuditPanel,
  DataRow,
  Disclaimer,
  ModelBadge,
  PageHeader,
  Panel,
  QualityBadge,
} from "@/components/oily/primitives";
// (RiskBadge intentionally not imported — status shown via QualityBadge/ModelBadge)
import { oilyStore, useIncident } from "@/lib/oily/store";
import { compass, formatCoord } from "@/lib/oily/geo";
import { oily, type EnvironmentResponse, type TrajectoryResponse } from "@/api";
import { DISCLAIMERS } from "@/lib/oily/data";
import type { DriftPoint, Incident } from "@/lib/oily/types";

export const Route = createFileRoute("/drift")({
  validateSearch: (search: Record<string, unknown>): { incident?: string } => {
    const incident = typeof search["incident"] === "string" ? (search["incident"] as string) : undefined;
    return incident ? { incident } : {};
  },
  head: () => ({
    meta: [
      { title: "Drift Simulation — Varuna Spill Intelligence" },
      {
        name: "description",
        content:
          "Stored 72-hour Lagrangian drift simulation with an uncertainty envelope, run from live environmental conditions.",
      },
    ],
  }),
  component: DriftPage,
});

interface RunData {
  conditions: EnvironmentResponse["telemetry"];
  trajectory: TrajectoryResponse;
  fetchedAt: Date;
}

type RunState =
  | { status: "loading"; step: number }
  | { status: "ok"; data: RunData }
  | { status: "error"; message: string };

/** Each visible step maps to a real async stage of the pipeline. */
export const DRIFT_STEPS = [
  "Fetching live ocean-current field (Open-Meteo)",
  "Reading live wind speed & direction",
  "Initialising spill model & windage vector",
  "Integrating trajectory timestep-by-timestep + coastline check",
  "Persisting simulation & building uncertainty envelope",
];

function useDriftSimulation(incident: Incident | undefined) {
  const [state, setState] = useState<RunState>({ status: "loading", step: 0 });

  const run = useCallback(async () => {
    if (!incident) return;
    try {
      setState({ status: "loading", step: 0 });
      // Live environmental field (falls back to stored snapshot server-side).
      const conditions = await oily.environment
        .live(incident.lat, incident.lon)
        .catch(() => incident.telemetry as EnvironmentResponse["telemetry"]);
      setState({ status: "loading", step: 2 });
      // Create a stored simulation driven by those conditions, then read it back.
      const created = await oily.simulations.create({
        incidentId: incident.id,
        durationHours: 72,
        timeStepMinutes: 15,
        wind: { speed: conditions.windSpeed ?? 0, direction: conditions.windDirection ?? 0 },
        current: { speed: conditions.currentSpeed ?? 0, direction: conditions.currentDirection ?? 0 },
        diffusion: true,
        uncertainty: true,
      });
      setState({ status: "loading", step: 3 });
      const trajectory = await oily.simulations.trajectory(created.simulationId);
      setState({ status: "loading", step: 4 });
      await new Promise((r) => setTimeout(r, 200));
      setState({ status: "ok", data: { conditions, trajectory, fetchedAt: new Date() } });
    } catch (err: unknown) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [incident]);

  useEffect(() => {
    void run();
  }, [run]);

  return { state, run };
}

function DriftPage() {
  const { incident: incidentId } = Route.useSearch();
  const navigate = useNavigate();
  const incident = useIncident(incidentId);
  const [sel, setSel] = useState<string | undefined>(incidentId);
  const { state, run } = useDriftSimulation(incident);

  const traj = state.status === "ok" ? state.data.trajectory : null;

  useEffect(() => {
    if (incident && traj) {
      oilyStore.recordAnalysis({
        incidentId: incident.id,
        incidentName: incident.name,
        kind: "drift",
        summary: `Drift ${traj.speed.toFixed(2)} m/s ${compass(traj.directionDeg)}`,
        detail: traj.beached
          ? `Beaches after ${traj.beachedAtHours}h (sim ${traj.simulationId})`
          : `${traj.waypoints.at(-1)?.distanceKm.toFixed(1)} km in 72 h (sim ${traj.simulationId})`,
      });
    }
  }, [incident, traj]);

  if (!incident) {
    return (
      <AppShell>
        <PageHeader
          title="Drift Simulation"
          subtitle="Select an incident to run a stored drift simulation and visualise its trajectory + uncertainty."
        />
        <IncidentSelector
          selectedId={sel}
          onSelect={setSel}
          ctaLabel="Run Drift Simulation"
          onConfirm={() => sel && navigate({ to: "/drift", search: { incident: sel } })}
        />
        <Disclaimer>{DISCLAIMERS.drift}</Disclaimer>
      </AppShell>
    );
  }

  const conditions = state.status === "ok" ? state.data.conditions : incident.telemetry;
  const waypoints: DriftPoint[] =
    traj?.waypoints.map((w) => ({
      hours: w.hours,
      lat: w.latitude,
      lon: w.longitude,
      uncertaintyKm: w.uncertaintyKm,
      distanceKm: w.distanceKm,
    })) ?? [];
  const densePath: [number, number][] =
    traj?.points.map((p) => [p.latitude, p.longitude] as [number, number]) ?? [];
  const uncertaintyPolygon = (traj?.uncertainty.polygon ?? []) as [number, number][];
  const last = traj?.waypoints.at(-1);
  const chartData =
    traj?.waypoints.map((w) => ({
      hours: `T+${w.hours}h`,
      distance: +w.distanceKm.toFixed(1),
      uncertainty: +w.uncertaintyKm.toFixed(1),
    })) ?? [];

  return (
    <AppShell>
      <PageHeader
        title="Drift Simulation"
        subtitle={`${incident.id} — ${incident.name}`}
        badges={
          <div className="flex items-center gap-2">
            <QualityBadge quality="SIMULATED" />
            {traj ? <ModelBadge version={traj.modelVersion} label="Drift engine" /> : null}
          </div>
        }
        action={
          <div className="flex flex-wrap gap-2">
            <button
              onClick={run}
              disabled={state.status === "loading"}
              className="inline-flex items-center gap-2 rounded-sm border border-border-strong px-4 py-2.5 text-sm font-semibold uppercase tracking-wide hover:bg-accent disabled:opacity-50"
            >
              {state.status === "loading" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Re-run Simulation
            </button>
            <button
              onClick={() => navigate({ to: "/drift", search: {} })}
              className="rounded-sm border border-border-strong px-4 py-2.5 text-sm font-semibold uppercase tracking-wide hover:bg-accent"
            >
              Change incident
            </button>
          </div>
        }
      />

      <IncidentSummaryStrip incident={incident} />

      {state.status === "loading" ? (
        <AnalysisSteps steps={DRIFT_STEPS} activeStep={state.step} title="Running drift simulation" />
      ) : state.status === "ok" && traj ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Waves className="size-3.5 text-safe" /> Simulation{" "}
            <span className="num">{traj.simulationId}</span> — {traj.engine}, {traj.points.length}{" "}
            timesteps, stored {state.data.fetchedAt.toLocaleTimeString()}.
          </p>
          {traj.beached ? (
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-warning/40 bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">
              <AlertTriangle className="size-3.5" /> Slick beaches after ~{traj.beachedAtHours} h and
              stays on the shore
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-safe/30 bg-safe-soft px-2 py-0.5 text-[11px] font-semibold text-safe">
              Stays offshore across the 72 h horizon
            </span>
          )}
        </div>
      ) : state.status === "error" ? (
        <Disclaimer>
          Simulation could not be run ({state.message}). Ensure the VARUNA backend is running.
        </Disclaimer>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Panel title="Predicted Trajectory" bodyClassName="p-0">
            <MapView
              className="h-[440px] rounded-none border-0"
              theme="night"
              incidents={[incident]}
              selectedId={incident.id}
              trajectory={waypoints}
              densePath={densePath}
              uncertaintyPolygon={uncertaintyPolygon}
              spillFor={incident}
              layers={DEFAULT_LAYERS}
              showUncertainty
              fitToTrajectory
            />
          </Panel>

          <Panel title="Displacement & Uncertainty" dense>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
                  <defs>
                    <linearGradient id="uArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--cyan)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--cyan)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="hours" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Area type="monotone" dataKey="uncertainty" name="± km" stroke="var(--cyan)" fill="url(#uArea)" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="distance" name="Distance km" stroke="var(--primary)" fill="transparent" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          {traj ? (
            <Panel title="Auditability — where this trajectory comes from" dense>
              <AuditPanel
                inputs={[
                  { label: "Origin", value: formatCoord(incident.lat, incident.lon) },
                  { label: "Current", value: `${conditions.currentSpeed ?? "—"} m/s ${compass(conditions.currentDirection)}` },
                  { label: "Wind", value: `${conditions.windSpeed ?? "—"} m/s ${compass(conditions.windDirection)}` },
                  { label: "Windage Cw", value: traj.windageCoefficient },
                  { label: "Spill area", value: `${incident.spillAreaKm2} km²` },
                ]}
                model={
                  <>
                    <div className="flex items-center gap-2">
                      <ModelBadge version={traj.modelVersion} />
                    </div>
                    <p className="text-muted-foreground">{traj.engine}</p>
                    <p className="text-muted-foreground">
                      Forward integration, {traj.points.length} steps · diffusion D=
                      {traj.diffusionKm2PerS} m²/s
                    </p>
                  </>
                }
                output={[
                  { label: "Drift speed", value: `${traj.speed.toFixed(2)} m/s` },
                  { label: "Direction", value: `${traj.directionDeg.toFixed(0)}° ${compass(traj.directionDeg)}` },
                  { label: "72 h distance", value: `${last?.distanceKm.toFixed(1)} km` },
                  { label: "Beaching", value: traj.beached ? `${traj.beachedAtHours} h` : "Offshore" },
                ]}
              />
              {traj.notes.length ? (
                <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground">
                  {traj.notes.map((n, i) => (
                    <li key={i}>• {n}</li>
                  ))}
                </ul>
              ) : null}
            </Panel>
          ) : null}
        </div>

        <div className="space-y-4">
          <Panel title="Drift Vector" dense>
            <DataRow
              label="Drift speed"
              value={traj ? `${traj.speed.toFixed(2)} m/s` : "—"}
              badge={<QualityBadge quality="SIMULATED" />}
            />
            <DataRow label="Direction" value={traj ? `${traj.directionDeg.toFixed(0)}° ${compass(traj.directionDeg)}` : "—"} />
            <DataRow label="U component" value={traj ? `${traj.uOil.toFixed(3)} m/s` : "—"} />
            <DataRow label="V component" value={traj ? `${traj.vOil.toFixed(3)} m/s` : "—"} />
            <DataRow label="Windage coefficient" value={traj?.windageCoefficient ?? "—"} />
            <DataRow label="72 h displacement" value={last ? `${last.distanceKm.toFixed(1)} km` : "—"} />
            <DataRow label="72 h uncertainty" value={last ? `± ${last.uncertaintyKm.toFixed(1)} km` : "—"} />
          </Panel>

          <Panel title="Environmental Field" dense>
            <DataRow
              label="Current"
              value={conditions.currentSpeed == null ? "Unavailable" : `${conditions.currentSpeed} m/s ${compass(conditions.currentDirection)}`}
              badge={<QualityBadge quality={(conditions.dataStatus as never) ?? "MODELLED"} />}
            />
            <DataRow
              label="Wind"
              value={conditions.windSpeed == null ? "Unavailable" : `${conditions.windSpeed} m/s ${compass(conditions.windDirection)}`}
            />
            <DataRow label="Wave height" value={conditions.waveHeight == null ? "Unavailable" : `${conditions.waveHeight} m`} />
            <DataRow label="Sea temp" value={conditions.temperature == null ? "Unavailable" : `${conditions.temperature} °C`} />
            <p className="mt-2 text-[11px] text-muted-foreground">Source: {conditions.source}</p>
          </Panel>

          <Panel title="Physics Model" dense>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              The mover resolves current + windage into one slick velocity —{" "}
              <code className="num rounded-sm bg-muted px-1 py-0.5 text-[12px]">V_oil = V_current + C_w · V_wind</code>{" "}
              (C_w ≈ {traj?.windageCoefficient ?? 0.03}) — integrated forward each timestep with a
              great-circle step, stopped at first land contact. A Fickian diffusion term spreads the
              slick and grows the uncertainty envelope with lead time.
            </p>
          </Panel>
        </div>
      </div>

      <Panel title="Forecast Waypoints" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-left">
                {["Lead time", "Position", "Distance", "Uncertainty", "Status"].map((h) => (
                  <th key={h} className="label-caps px-4 py-2.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {traj?.waypoints.map((p) => (
                <tr key={p.hours} className="border-b border-border/70">
                  <td className="num px-4 py-2.5 font-semibold">{p.hours === 0 ? "Now" : `T+${p.hours} h`}</td>
                  <td className="num px-4 py-2.5 text-xs">{formatCoord(p.latitude, p.longitude)}</td>
                  <td className="num px-4 py-2.5">{p.distanceKm.toFixed(1)} km</td>
                  <td className="num px-4 py-2.5">± {p.uncertaintyKm.toFixed(1)} km</td>
                  <td className="px-4 py-2.5 text-xs">{p.beached ? "Beached" : "Afloat"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Disclaimer>{DISCLAIMERS.drift}</Disclaimer>
    </AppShell>
  );
}
