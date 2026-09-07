import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import { AppShell } from "@/components/oily/AppShell";
import { MapView, DEFAULT_LAYERS } from "@/components/oily/MapView";
import { IncidentSelector, IncidentSummaryStrip } from "@/components/oily/IncidentSelector";
import {
  DataRow,
  Disclaimer,
  ModelBadge,
  PageHeader,
  Panel,
  QualityBadge,
} from "@/components/oily/primitives";
import { useIncident } from "@/lib/oily/store";
import { compass } from "@/lib/oily/geo";
import { oily, type ScenarioResult } from "@/api";
import { DISCLAIMERS } from "@/lib/oily/data";

export const Route = createFileRoute("/what-if")({
  validateSearch: (search: Record<string, unknown>): { incident?: string } => {
    const incident = typeof search["incident"] === "string" ? (search["incident"] as string) : undefined;
    return incident ? { incident } : {};
  },
  head: () => ({
    meta: [
      { title: "What-If Simulator — Varuna Spill Intelligence" },
      {
        name: "description",
        content:
          "Change wind, current, volume and windage and re-run the real drift simulation to compare a scenario trajectory against the baseline.",
      },
    ],
  }),
  component: WhatIfPage,
});

interface Knobs {
  windScale: number;
  windDirectionDelta: number;
  currentScale: number;
  currentDirectionDelta: number;
  volumeScale: number;
  windage: number;
}

const DEFAULTS: Knobs = {
  windScale: 1,
  windDirectionDelta: 0,
  currentScale: 1,
  currentDirectionDelta: 0,
  volumeScale: 1,
  windage: 0.03,
};

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="label-caps">{label}</label>
        <span className="num text-sm font-semibold">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-[var(--primary)]"
      />
    </div>
  );
}

function WhatIfPage() {
  const { incident: incidentId } = Route.useSearch();
  const navigate = useNavigate();
  const incident = useIncident(incidentId);
  const [sel, setSel] = useState<string | undefined>(incidentId);
  const [knobs, setKnobs] = useState<Knobs>(DEFAULTS);
  const [state, setState] = useState<
    { s: "idle" } | { s: "loading" } | { s: "ok"; data: ScenarioResult } | { s: "error"; msg: string }
  >({ s: "idle" });

  const set = (k: keyof Knobs) => (v: number) => setKnobs((prev) => ({ ...prev, [k]: v }));

  async function runScenario() {
    if (!incident) return;
    setState({ s: "loading" });
    try {
      const data = await oily.simulations.scenario({
        incidentId: incident.id,
        durationHours: 72,
        scenario: { ...knobs },
      });
      setState({ s: "ok", data });
    } catch (e: unknown) {
      setState({ s: "error", msg: e instanceof Error ? e.message : String(e) });
    }
  }

  if (!incident) {
    return (
      <AppShell>
        <PageHeader
          title="What-If Simulator"
          subtitle="Select an incident, change the environmental drivers, and re-run the real drift engine."
        />
        <IncidentSelector
          selectedId={sel}
          onSelect={setSel}
          ctaLabel="Open Simulator"
          onConfirm={() => sel && navigate({ to: "/what-if", search: { incident: sel } })}
        />
        <Disclaimer>{DISCLAIMERS.drift}</Disclaimer>
      </AppShell>
    );
  }

  const result = state.s === "ok" ? state.data : null;
  const basePath = (result?.baseline.points.map((p) => [p.latitude, p.longitude]) ?? []) as [number, number][];
  const scenPath = (result?.scenario.points.map((p) => [p.latitude, p.longitude]) ?? []) as [number, number][];
  const uncertainty = (result?.baseline.uncertaintyPolygon ?? []) as [number, number][];

  return (
    <AppShell>
      <PageHeader
        title="What-If Simulator"
        subtitle={`${incident.id} — ${incident.name}`}
        badges={
          <div className="flex items-center gap-2">
            <QualityBadge quality="SIMULATED" />
            {result ? <ModelBadge version={result.modelVersion} label="Drift engine" /> : null}
          </div>
        }
        action={
          <button
            onClick={() => navigate({ to: "/what-if", search: {} })}
            className="rounded-sm border border-border-strong px-4 py-2.5 text-sm font-semibold uppercase tracking-wide hover:bg-accent"
          >
            Change incident
          </button>
        }
      />

      <IncidentSummaryStrip incident={incident} />

      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <Panel title="Scenario Drivers" dense>
            <div className="space-y-4">
              <Slider label="Wind speed ×" value={knobs.windScale} min={0} max={3} step={0.1} suffix="×" onChange={set("windScale")} />
              <Slider label="Wind direction Δ" value={knobs.windDirectionDelta} min={-180} max={180} step={5} suffix="°" onChange={set("windDirectionDelta")} />
              <Slider label="Current speed ×" value={knobs.currentScale} min={0} max={3} step={0.1} suffix="×" onChange={set("currentScale")} />
              <Slider label="Current direction Δ" value={knobs.currentDirectionDelta} min={-180} max={180} step={5} suffix="°" onChange={set("currentDirectionDelta")} />
              <Slider label="Spill volume ×" value={knobs.volumeScale} min={0.25} max={4} step={0.25} suffix="×" onChange={set("volumeScale")} />
              <Slider label="Windage Cw" value={knobs.windage} min={0} max={0.06} step={0.005} onChange={set("windage")} />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={runScenario}
                disabled={state.s === "loading"}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-sm bg-primary px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-primary-foreground hover:brightness-110 disabled:opacity-50"
              >
                {state.s === "loading" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                Run Scenario
              </button>
              <button
                onClick={() => setKnobs(DEFAULTS)}
                className="rounded-sm border border-border-strong px-3 py-2.5 text-xs font-semibold uppercase tracking-wide hover:bg-accent"
              >
                Reset
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Each run re-executes the real drift engine — the scenario track is recalculated, not
              animated.
            </p>
          </Panel>

          {result ? (
            <Panel title="Baseline vs Scenario" dense>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="label-caps py-1.5">Metric</th>
                    <th className="label-caps py-1.5 text-right">Baseline</th>
                    <th className="label-caps py-1.5 text-right">Scenario</th>
                  </tr>
                </thead>
                <tbody className="num">
                  <tr className="border-b border-border/60">
                    <td className="py-1.5">Drift speed</td>
                    <td className="py-1.5 text-right">{result.baseline.speed.toFixed(2)}</td>
                    <td className="py-1.5 text-right">{result.scenario.speed.toFixed(2)} m/s</td>
                  </tr>
                  <tr className="border-b border-border/60">
                    <td className="py-1.5">Direction</td>
                    <td className="py-1.5 text-right">{compass(result.baseline.directionDeg)}</td>
                    <td className="py-1.5 text-right">{compass(result.scenario.directionDeg)}</td>
                  </tr>
                  <tr className="border-b border-border/60">
                    <td className="py-1.5">72 h distance</td>
                    <td className="py-1.5 text-right">{result.baseline.distanceKm.toFixed(1)}</td>
                    <td className="py-1.5 text-right">{result.scenario.distanceKm.toFixed(1)} km</td>
                  </tr>
                  <tr>
                    <td className="py-1.5">Coastline arrival</td>
                    <td className="py-1.5 text-right">{result.baseline.beachedAtHours ?? "—"}</td>
                    <td className="py-1.5 text-right">
                      {result.scenario.beachedAtHours ?? "—"} h
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-3 space-y-1">
                <DataRow label="Δ drift speed" value={`${result.differences.driftSpeedDelta >= 0 ? "+" : ""}${result.differences.driftSpeedDelta} m/s`} />
                <DataRow label="Δ 72 h distance" value={`${result.differences.distanceDeltaKm >= 0 ? "+" : ""}${result.differences.distanceDeltaKm} km`} />
              </div>
            </Panel>
          ) : null}

          {state.s === "error" ? (
            <Disclaimer>Scenario run failed ({state.msg}). Ensure the VARUNA backend is running.</Disclaimer>
          ) : null}
        </div>

        <Panel title="Trajectory Comparison" bodyClassName="p-0">
          <MapView
            className="h-[560px] rounded-none border-0"
            theme="night"
            incidents={[incident]}
            selectedId={incident.id}
            spillFor={incident}
            densePath={basePath}
            comparePath={scenPath}
            uncertaintyPolygon={uncertainty}
            layers={DEFAULT_LAYERS}
            showUncertainty
            fitToTrajectory
          />
          <div className="flex flex-wrap items-center gap-4 border-t border-border px-4 py-2 text-xs">
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-cyan" /> Baseline</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: "#f59e0b" }} /> Scenario</span>
            <span className="text-muted-foreground">Uncertainty envelope shown for baseline.</span>
          </div>
        </Panel>
      </div>

      <Disclaimer>{DISCLAIMERS.drift}</Disclaimer>
    </AppShell>
  );
}
