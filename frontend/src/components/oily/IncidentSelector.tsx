import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOily } from "@/lib/oily/store";
import { buildIntelligence } from "@/lib/oily/engine";
import { compass } from "@/lib/oily/geo";
import { MapView } from "./MapView";
import { Panel, RiskBadge } from "./primitives";
import type { Incident } from "@/lib/oily/types";

/** Reusable incident selector: search list + select-from-map, used by Impact, Drift, Response, Twin. */
export function IncidentSelector({
  selectedId,
  onSelect,
  ctaLabel,
  onConfirm,
  title = "Select Incident",
}: {
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  ctaLabel: string;
  onConfirm: () => void;
  title?: string;
}) {
  const { incidents } = useOily();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return incidents;
    return incidents.filter((i) =>
      [i.id, i.name, i.region, i.oilType].some((f) => f.toLowerCase().includes(q)),
    );
  }, [incidents, query]);

  const popupExtras = useMemo(() => {
    const out: Record<string, { drift?: string; coast?: string }> = {};
    for (const incident of incidents) {
      const { forecast, impact } = buildIntelligence(incident);
      const coast = impact.exposures.find((e) => e.feature === "Coastline");
      out[incident.id] = {
        drift: `${forecast.speed.toFixed(2)} m/s ${compass(forecast.directionDeg)}`,
        coast: coast?.hours != null ? `${coast.hours}h` : "not intersected",
      };
    }
    return out;
  }, [incidents]);

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      <Panel title={title} dense>
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search incidents…"
            className="w-full rounded-sm border border-input bg-surface py-2 pl-8 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <ul className="max-h-[420px] space-y-1.5 overflow-y-auto">
          {filtered.map((incident) => (
            <li key={incident.id}>
              <button
                onClick={() => onSelect(incident.id)}
                className={cn(
                  "w-full rounded-sm border px-3 py-2.5 text-left transition-colors",
                  selectedId === incident.id
                    ? "border-primary bg-info-soft"
                    : "border-border bg-surface hover:border-border-strong",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="num text-[13px] font-semibold">{incident.id}</span>
                  <RiskBadge level={incident.risk} />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{incident.region}</p>
                <p className="num mt-0.5 text-xs">
                  {incident.volumeTonnes.toLocaleString()} tonnes · {incident.oilType}
                </p>
              </button>
            </li>
          ))}
          {filtered.length === 0 ? (
            <li className="py-6 text-center text-xs text-muted-foreground">No incidents match.</li>
          ) : null}
        </ul>
        <button
          onClick={onConfirm}
          disabled={!selectedId}
          className="mt-3 w-full rounded-sm bg-primary px-4 py-2.5 text-[13px] font-semibold uppercase tracking-wide text-primary-foreground transition-colors hover:brightness-110 disabled:opacity-40"
        >
          {ctaLabel}
        </button>
      </Panel>

      <Panel title="Select from map" dense bodyClassName="p-0">
        <MapView
          className="h-[420px] rounded-none border-0 lg:h-[520px]"
          incidents={incidents}
          selectedId={selectedId}
          onSelect={onSelect}
          popupExtras={popupExtras}
        />
      </Panel>
    </div>
  );
}

export function IncidentSummaryStrip({ incident }: { incident: Incident }) {
  const { forecast, impact } = buildIntelligence(incident);
  const coast = impact.exposures.find((e) => e.feature === "Coastline");
  const cells = [
    { label: "Incident", value: incident.id },
    { label: "Region", value: incident.region },
    { label: "Volume", value: `${incident.volumeTonnes.toLocaleString()} t` },
    { label: "Drift", value: `${forecast.speed.toFixed(2)} m/s ${compass(forecast.directionDeg)}` },
    { label: "Impact", value: `${impact.score}/100 ${impact.severity}` },
    { label: "Coastline", value: coast?.hours != null ? `${coast.hours} h` : "—" },
  ];
  return (
    <div className="grid grid-cols-2 divide-x divide-border rounded-md border border-border bg-card sm:grid-cols-3 lg:grid-cols-6">
      {cells.map((c) => (
        <div key={c.label} className="px-3 py-2.5">
          <p className="label-caps">{c.label}</p>
          <p className="num mt-0.5 text-sm font-semibold">{c.value}</p>
        </div>
      ))}
    </div>
  );
}
