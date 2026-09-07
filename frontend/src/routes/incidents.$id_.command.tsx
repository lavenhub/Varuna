import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowLeft, Clock, Compass, Leaf, SlidersHorizontal, Waves } from "lucide-react";
import { AppShell } from "@/components/oily/AppShell";
import { MapView, DEFAULT_LAYERS } from "@/components/oily/MapView";
import {
  Bar,
  Chain,
  DataRow,
  Disclaimer,
  EmptyState,
  MetricCard,
  Panel,
  RiskBadge,
  ScoreGauge,
  StatusBadge,
  TelemetryCard,
  Timeline,
} from "@/components/oily/primitives";
import { oilyStore, useIncident, useOily } from "@/lib/oily/store";
import { buildIntelligence } from "@/lib/oily/engine";
import { compass, formatCoord } from "@/lib/oily/geo";
import { DISCLAIMERS } from "@/lib/oily/data";
import type { IncidentStatus } from "@/lib/oily/types";

export const Route = createFileRoute("/incidents/$id_/command")({
  head: () => ({
    meta: [
      { title: "Command Center — Varuna Incident Operations" },
      {
        name: "description",
        content:
          "Single-incident command console combining live map, impact, drift, response actions and resources.",
      },
      { property: "og:title", content: "Command Center — Varuna" },
      {
        property: "og:description",
        content: "Consolidated command console for coordinating an oil-spill response.",
      },
    ],
  }),
  component: CommandCenter,
});

const LIFECYCLE: IncidentStatus[] = [
  "DETECTED",
  "CLASSIFIED",
  "CONFIRMED",
  "ANALYZING",
  "RESPONDING",
  "CONTAINED",
  "CLOSED",
];

function CommandCenter() {
  const { id } = useParams({ from: "/incidents/$id_/command" });
  const incident = useIncident(id);
  const { timeline } = useOily();
  const intel = useMemo(() => (incident ? buildIntelligence(incident) : null), [incident]);

  if (!incident || !intel) {
    return (
      <AppShell>
        <EmptyState
          title="Incident not found"
          description="This incident is not present in the registry."
          action={
            <Link
              to="/incidents"
              className="rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Back to registry
            </Link>
          }
        />
      </AppShell>
    );
  }

  const { forecast, impact, plan } = intel;
  const t = incident.telemetry;
  const coast = impact.exposures.find((e) => e.feature === "Coastline");

  return (
    <AppShell contentClassName="bg-background">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/incidents/$id"
              params={{ id: incident.id }}
              className="inline-flex items-center gap-1.5 rounded-sm border border-border-strong px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide hover:bg-accent"
            >
              <ArrowLeft className="size-3.5" /> Incident
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">Command Center</h1>
            <RiskBadge level={impact.severity} label={`${impact.severity} priority`} />
            <StatusBadge status={incident.status} />
          </div>
          <p className="num mt-1 text-sm text-muted-foreground">
            {incident.id} — {incident.name} · {formatCoord(incident.lat, incident.lon)}
          </p>
        </div>
        <select
          value={incident.status}
          onChange={(e) => {
            const next = e.target.value as IncidentStatus;
            oilyStore.updateIncident(incident.id, { status: next });
            oilyStore.appendTimeline(incident.id, `Status changed to ${next}`);
          }}
          className="rounded-sm border border-input bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary"
        >
          {LIFECYCLE.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Impact Score" value={`${impact.score}/100`} tone="warning" hint={impact.severity} />
        <MetricCard
          label="Drift"
          value={`${forecast.speed.toFixed(2)} m/s`}
          hint={compass(forecast.directionDeg)}
        />
        <MetricCard
          label="Coastline ETA"
          value={coast?.hours != null ? `${coast.hours} h` : "—"}
          tone="critical"
          hint="To sensitive coast"
        />
        <MetricCard label="Personnel" value={plan.manpower.total} hint="Planning estimate" />
        <MetricCard label="Confidence" value={`${impact.confidence}%`} tone="primary" hint="Model confidence" />
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { to: "/drift", label: "Run Drift Simulation", icon: Waves },
          { to: "/what-if", label: "What-If Simulator", icon: SlidersHorizontal },
          { to: "/impact", label: "Impact Analysis", icon: Leaf },
          { to: "/response", label: "Full Response Plan", icon: Compass },
        ].map((a) => (
          <Link
            key={a.to}
            to={a.to}
            search={{ incident: incident.id }}
            className="inline-flex items-center gap-2 rounded-sm border border-border-strong bg-card px-3.5 py-2 text-xs font-semibold uppercase tracking-wide hover:border-primary/40 hover:bg-accent"
          >
            <a.icon className="size-3.5 text-primary" /> {a.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Panel title="Live Operating Picture" bodyClassName="p-0">
            <MapView
              className="h-[460px] rounded-none border-0"
              theme="night"
              incidents={[incident]}
              selectedId={incident.id}
              trajectory={forecast.points}
              spillFor={incident}
              layers={DEFAULT_LAYERS}
              showUncertainty
              fitToTrajectory
            />
          </Panel>

          <Panel title="Ranked Actions" dense>
            <ol className="space-y-2.5">
              {plan.actions.map((action) => (
                <li key={action.rank} className="rounded-md border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="num flex size-6 shrink-0 items-center justify-center rounded-sm bg-navy text-xs font-semibold text-navy-foreground">
                        {action.rank}
                      </span>
                      <h3 className="text-sm font-semibold">{action.title}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="num flex items-center gap-1 text-[11px] uppercase tracking-wider text-critical">
                        <Clock className="size-3" /> {action.timing}
                      </span>
                      <RiskBadge level={action.priority} />
                    </div>
                  </div>
                  <p className="mt-1.5 text-[13px] text-muted-foreground">{action.action}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Environmental Severity">
            <ScoreGauge score={impact.score} severity={impact.severity} confidence={impact.confidence} />
            <div className="mt-4 space-y-2.5">
              {impact.components.map((c) => (
                <div key={c.label}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span>{c.label}</span>
                    <span className="num font-semibold">{c.value}</span>
                  </div>
                  <Bar value={c.value} />
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Telemetry" dense>
            <div className="grid grid-cols-2 gap-2">
              <TelemetryCard label="Current" value={t.currentSpeed} unit="m/s" />
              <TelemetryCard label="Wind" value={t.windSpeed} unit="m/s" />
              <TelemetryCard label="Wave" value={t.waveHeight} unit="m" />
              <TelemetryCard label="Sea temp" value={t.temperature} unit="°C" />
            </div>
          </Panel>

          <Panel title="Resources" dense>
            {plan.resources.map((r) => (
              <DataRow key={r.resource} label={r.resource} value={r.recommended} badge={undefined} />
            ))}
          </Panel>

          <Panel title="Top Reasoning" dense>
            <Chain steps={impact.reasoning.slice(0, 4).map((r) => `${r.driver} → ${r.effect}`)} />
          </Panel>

          <Panel title="Incident Timeline" dense>
            {(timeline[incident.id]?.length ?? 0) > 0 ? (
              <Timeline items={timeline[incident.id]!} />
            ) : (
              <p className="text-[13px] text-muted-foreground">No timeline events recorded yet.</p>
            )}
          </Panel>
        </div>
      </div>

      <Disclaimer>{DISCLAIMERS.general}</Disclaimer>
    </AppShell>
  );
}
