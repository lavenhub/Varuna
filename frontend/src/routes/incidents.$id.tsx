import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { AppShell } from "@/components/oily/AppShell";
import { MapView, DEFAULT_LAYERS } from "@/components/oily/MapView";
import {
  Bar,
  DataRow,
  Disclaimer,
  EmptyState,
  PageHeader,
  Panel,
  QualityBadge,
  RiskBadge,
  ScoreGauge,
  StatusBadge,
  TelemetryCard,
} from "@/components/oily/primitives";
import { oilyStore, useIncident, useOily } from "@/lib/oily/store";
import { buildIntelligence, findSimilarIncidents } from "@/lib/oily/engine";
import { compass, formatCoord } from "@/lib/oily/geo";
import { DISCLAIMERS } from "@/lib/oily/data";
import type { IncidentStatus } from "@/lib/oily/types";

export const Route = createFileRoute("/incidents/$id")({
  head: () => ({
    meta: [
      { title: "Incident Details — Varuna Spill Intelligence" },
      {
        name: "description",
        content:
          "Full incident record: detection data, telemetry, drift forecast, environmental impact and response readiness.",
      },
      { property: "og:title", content: "Incident Details — Varuna" },
      {
        property: "og:description",
        content: "Detection data, telemetry, drift, impact and response for a single spill incident.",
      },
    ],
  }),
  component: IncidentDetail,
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

function IncidentDetail() {
  const { id } = useParams({ from: "/incidents/$id" });
  const incident = useIncident(id);
  const { timeline } = useOily();

  const intel = useMemo(() => (incident ? buildIntelligence(incident) : null), [incident]);
  const similar = useMemo(() => (incident ? findSimilarIncidents(incident, 3) : []), [incident]);

  if (!incident || !intel) {
    return (
      <AppShell>
        <EmptyState
          title="Incident not found"
          description="This incident is not present in the registry. It may have been reset or never logged."
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
  const events = timeline[incident.id] ?? [];
  const stageIndex = LIFECYCLE.indexOf(incident.status);

  return (
    <AppShell>
      <PageHeader
        title={`${incident.id} — ${incident.name}`}
        subtitle={`${formatCoord(incident.lat, incident.lon)} · ${incident.region} · detected ${new Date(
          incident.detectedAt,
        ).toUTCString().replace("GMT", "UTC")}`}
        badges={
          <>
            <RiskBadge level={impact.severity} />
            <StatusBadge status={incident.status} />
          </>
        }
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              to="/incidents/$id/command"
              params={{ id: incident.id }}
              className="inline-flex items-center gap-2 rounded-sm bg-critical px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-white hover:brightness-110"
            >
              Open Command Center <ArrowRight className="size-4" />
            </Link>
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
        }
      />

      <Panel title="Incident Lifecycle" dense>
        <ol className="flex flex-wrap gap-2">
          {LIFECYCLE.map((stage, i) => (
            <li
              key={stage}
              className={`num rounded-sm border px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider ${
                i <= stageIndex
                  ? "border-primary/40 bg-info-soft text-primary"
                  : "border-border bg-surface text-muted-foreground"
              }`}
            >
              {stage}
            </li>
          ))}
        </ol>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Panel title="Predicted Trajectory" bodyClassName="p-0">
            <MapView
              className="h-[420px] rounded-none border-0"
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

          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Detection Record" dense>
              <DataRow label="Detection source" value={incident.detectionSource} />
              <DataRow
                label="ML confidence"
                value={`${(incident.mlConfidence * 100).toFixed(1)}%`}
                badge={<QualityBadge quality="MODELLED" />}
              />
              <DataRow label="Oil type" value={incident.oilType} />
              <DataRow label="Persistence" value={incident.persistence} />
              <DataRow label="Volume" value={`${incident.volumeTonnes.toLocaleString()} t`} badge={<QualityBadge quality="ESTIMATED" />} />
              <DataRow label="Spill area" value={`${incident.spillAreaKm2} km²`} badge={<QualityBadge quality="ESTIMATED" />} />
              <DataRow label="Cause" value={incident.cause} />
              {incident.notes ? <DataRow label="Notes" value={incident.notes} /> : null}
            </Panel>

            <Panel title="Environmental Telemetry" dense>
              <div className="grid grid-cols-2 gap-2">
                <TelemetryCard label="Current" value={t.currentSpeed} unit="m/s" />
                <TelemetryCard
                  label="Current dir"
                  value={t.currentDirection === null ? null : `${t.currentDirection}° ${compass(t.currentDirection)}`}
                />
                <TelemetryCard label="Wind" value={t.windSpeed} unit="m/s" />
                <TelemetryCard
                  label="Wind dir"
                  value={t.windDirection === null ? null : `${t.windDirection}° ${compass(t.windDirection)}`}
                />
                <TelemetryCard label="Wave height" value={t.waveHeight} unit="m" />
                <TelemetryCard label="Sea temp" value={t.temperature} unit="°C" />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">Source: {t.source}</p>
            </Panel>
          </div>

          <Panel title="Environmental Impact Summary">
            <ScoreGauge score={impact.score} severity={impact.severity} confidence={impact.confidence} />
            <div className="mt-4 space-y-3">
              {impact.components.map((c) => (
                <div key={c.label}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span>{c.label}</span>
                    <span className="num font-semibold">{c.value}</span>
                  </div>
                  <Bar value={c.value} />
                  <p className="mt-1 text-[11px] text-muted-foreground">{c.note}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                to="/impact"
                search={{ incident: incident.id }}
                className="rounded-sm border border-border-strong px-3 py-2 text-xs font-semibold uppercase tracking-wide hover:bg-accent"
              >
                Full impact analysis
              </Link>
              <Link
                to="/drift"
                search={{ incident: incident.id }}
                className="rounded-sm border border-border-strong px-3 py-2 text-xs font-semibold uppercase tracking-wide hover:bg-accent"
              >
                Drift analysis
              </Link>
              <Link
                to="/response"
                search={{ incident: incident.id }}
                className="rounded-sm border border-border-strong px-3 py-2 text-xs font-semibold uppercase tracking-wide hover:bg-accent"
              >
                Emergency response
              </Link>
            </div>
            <Disclaimer>{DISCLAIMERS.impact}</Disclaimer>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Drift Summary" dense>
            <DataRow label="Drift speed" value={`${forecast.speed.toFixed(2)} m/s`} badge={<QualityBadge quality="MODELLED" />} />
            <DataRow
              label="Direction"
              value={`${forecast.directionDeg.toFixed(0)}° ${compass(forecast.directionDeg)}`}
            />
            <DataRow label="Windage coefficient" value={forecast.windageCoefficient} />
            <DataRow
              label="72 h displacement"
              value={`${forecast.points[forecast.points.length - 1]!.distanceKm.toFixed(1)} km`}
            />
          </Panel>

          <Panel title="Exposure Estimates" dense>
            <ul className="space-y-2">
              {impact.exposures.map((e) => (
                <li key={e.feature} className="flex items-center justify-between gap-2 text-sm">
                  <span>{e.feature}</span>
                  <span className="num flex items-center gap-2 text-xs">
                    {e.hours != null ? `${e.hours} h` : "not intersected"}
                    <RiskBadge level={e.severity} />
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Incident Timeline" dense>
            <ol className="space-y-2">
              {events.map((ev, i) => (
                <li key={ev.time + i} className="flex gap-2.5 text-[13px]">
                  <span className="num shrink-0 text-muted-foreground">{ev.time}</span>
                  <span>{ev.text}</span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Top Ranked Action" dense>
            <p className="text-sm font-semibold">{plan.actions[0]?.title}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{plan.actions[0]?.reason}</p>
            <p className="num mt-2 text-[11px] uppercase tracking-wider text-critical">
              {plan.actions[0]?.timing}
            </p>
          </Panel>

          <Panel title="Similar Historical Incidents" dense>
            <ul className="space-y-2">
              {similar.map((m) => (
                <li key={m.historical.id}>
                  <Link
                    to="/history/$id"
                    params={{ id: m.historical.id }}
                    className="block rounded-sm border border-border bg-surface px-3 py-2 hover:border-primary/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold">{m.historical.name}</span>
                      <span className="num text-xs text-primary">{m.similarity}%</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{m.reasons[0] ?? m.historical.location}</p>
                  </Link>
                </li>
              ))}
            </ul>
            <Disclaimer>{DISCLAIMERS.similarity}</Disclaimer>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
