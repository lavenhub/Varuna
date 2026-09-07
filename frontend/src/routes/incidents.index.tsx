import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/oily/AppShell";
import { MapView, DEFAULT_LAYERS } from "@/components/oily/MapView";
import {
  Disclaimer,
  EmptyState,
  PageHeader,
  Panel,
  RiskBadge,
  StatusBadge,
} from "@/components/oily/primitives";
import { useOily } from "@/lib/oily/store";
import { buildIntelligence } from "@/lib/oily/engine";
import { compass, formatCoord } from "@/lib/oily/geo";
import { DISCLAIMERS } from "@/lib/oily/data";
import { cn } from "@/lib/utils";
import type { IncidentStatus, RiskLevel } from "@/lib/oily/types";

export const Route = createFileRoute("/incidents/")({
  head: () => ({
    meta: [
      { title: "Incident Registry — Varuna Spill Operations" },
      {
        name: "description",
        content:
          "Searchable registry of detected oil-spill incidents with risk classification, status and predicted drift.",
      },
      { property: "og:title", content: "Incident Registry — Varuna" },
      {
        property: "og:description",
        content: "All detected oil-spill incidents with risk, status and drift context.",
      },
    ],
  }),
  component: IncidentsPage,
});

const STATUSES: (IncidentStatus | "ALL")[] = [
  "ALL",
  "DETECTED",
  "CONFIRMED",
  "ANALYZING",
  "RESPONDING",
  "CONTAINED",
  "CLOSED",
];
const RISKS: (RiskLevel | "ALL")[] = ["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"];

function IncidentsPage() {
  const { incidents } = useOily();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<IncidentStatus | "ALL">("ALL");
  const [risk, setRisk] = useState<RiskLevel | "ALL">("ALL");

  const rows = useMemo(
    () =>
      incidents
        .map((incident) => {
          const { forecast, impact } = buildIntelligence(incident);
          const coast = impact.exposures.find((e) => e.feature === "Coastline");
          return { incident, forecast, impact, coastHours: coast?.hours ?? null };
        })
        .filter(({ incident, impact }) => {
          const q = query.trim().toLowerCase();
          const matchQ =
            !q ||
            [incident.id, incident.name, incident.region, incident.oilType, incident.cause].some((f) =>
              f.toLowerCase().includes(q),
            );
          return (
            matchQ &&
            (status === "ALL" || incident.status === status) &&
            (risk === "ALL" || impact.severity === risk)
          );
        }),
    [incidents, query, status, risk],
  );

  return (
    <AppShell>
      <PageHeader
        title="Incident Registry"
        subtitle="Every detected spill, its classification, current lifecycle state and predicted drift."
        action={
          <Link
            to="/detect"
            className="rounded-sm bg-critical px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-white hover:brightness-110"
          >
            Detect New Spill
          </Link>
        }
      />

      <Panel title="Filters" dense>
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by ID, name, region, oil type or cause"
            className="rounded-sm border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as IncidentStatus | "ALL")}
            className="rounded-sm border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === "ALL" ? "All statuses" : s}
              </option>
            ))}
          </select>
          <select
            value={risk}
            onChange={(e) => setRisk(e.target.value as RiskLevel | "ALL")}
            className="rounded-sm border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          >
            {RISKS.map((r) => (
              <option key={r} value={r}>
                {r === "ALL" ? "All severities" : r}
              </option>
            ))}
          </select>
        </div>
      </Panel>

      <Panel title={`Incidents (${rows.length})`} bodyClassName="p-0">
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No incidents match these filters"
              description="Adjust the search text, status or severity filter to widen the result set."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface text-left">
                  {[
                    "Incident",
                    "Location",
                    "Oil",
                    "Volume",
                    "Drift",
                    "Coastline",
                    "Impact",
                    "Status",
                  ].map((h) => (
                    <th key={h} className="label-caps px-4 py-2.5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ incident, forecast, impact, coastHours }) => (
                  <tr
                    key={incident.id}
                    onClick={() => navigate({ to: "/incidents/$id", params: { id: incident.id } })}
                    className="cursor-pointer border-b border-border/70 transition-colors hover:bg-accent/60"
                  >
                    <td className="px-4 py-2.5">
                      <span className="num font-semibold">{incident.id}</span>
                      <p className="text-xs text-muted-foreground">{incident.name}</p>
                    </td>
                    <td className="num px-4 py-2.5 text-xs">
                      {formatCoord(incident.lat, incident.lon)}
                      <p className="text-muted-foreground">{incident.region}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {incident.oilType}
                      <p className="text-muted-foreground">{incident.persistence}</p>
                    </td>
                    <td className="num px-4 py-2.5">{incident.volumeTonnes.toLocaleString()} t</td>
                    <td className="num px-4 py-2.5 text-xs">
                      {forecast.speed.toFixed(2)} m/s {compass(forecast.directionDeg)}
                    </td>
                    <td className="num px-4 py-2.5 text-xs">
                      {coastHours != null ? `${coastHours} h` : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="num mr-2 font-semibold">{impact.score}</span>
                      <RiskBadge level={impact.severity} />
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={incident.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Registry Map" bodyClassName="p-0">
        <MapView
          className={cn("h-[380px] rounded-none border-0")}
          incidents={rows.map((r) => r.incident)}
          layers={DEFAULT_LAYERS}
          onSelect={(id) => navigate({ to: "/incidents/$id", params: { id } })}
        />
      </Panel>

      <Disclaimer>{DISCLAIMERS.drift}</Disclaimer>
    </AppShell>
  );
}
