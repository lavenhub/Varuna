import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Bar as ReBar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link } from "@tanstack/react-router";
import { AppShell } from "@/components/oily/AppShell";
import {
  Disclaimer,
  EmptyState,
  MetricCard,
  PageHeader,
  Panel,
  RiskBadge,
  StatusBadge,
} from "@/components/oily/primitives";
import { useEffect } from "react";
import { useOily } from "@/lib/oily/store";
import { oily, type HistoricalRecord } from "@/api";
import { DISCLAIMERS } from "@/lib/oily/data";
import type { RiskLevel } from "@/lib/oily/types";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Historical Incidents — Varuna Spill Repository" },
      {
        name: "description",
        content:
          "Searchable repository of historical oil-spill incidents used for similarity comparison and precedent analysis.",
      },
      { property: "og:title", content: "Historical Incidents — Varuna" },
      {
        property: "og:description",
        content: "Repository of past oil-spill incidents with volume, oil type and coastal impact.",
      },
    ],
  }),
  component: HistoryPage,
});

const IMPACTS: (RiskLevel | "ALL")[] = ["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"];

function HistoryPage() {
  const navigate = useNavigate();
  const { incidents: liveIncidents } = useOily();
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("ALL");
  const [impact, setImpact] = useState<RiskLevel | "ALL">("ALL");
  // Real NOAA historical dataset, served by the backend.
  const [records, setRecords] = useState<HistoricalRecord[]>([]);
  useEffect(() => {
    let cancelled = false;
    oily.history
      .list(300)
      .then((data) => !cancelled && setRecords(data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const regions = useMemo(
    () => ["ALL", ...Array.from(new Set(records.map((h) => h.region))).sort()],
    [records],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((h) => {
      const matchQ =
        !q ||
        [h.name, h.location, h.oilType, h.cause, h.region].some((f) => f.toLowerCase().includes(q));
      return (
        matchQ && (region === "ALL" || h.region === region) && (impact === "ALL" || h.impact === impact)
      );
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [query, region, impact, records]);

  const byDecade = useMemo(() => {
    const buckets: Record<string, number> = {};
    for (const h of records) {
      const yr = Number(h.date.slice(0, 4));
      if (!yr) continue;
      const decade = `${Math.floor(yr / 10) * 10}s`;
      buckets[decade] = (buckets[decade] ?? 0) + 1;
    }
    return Object.entries(buckets)
      .map(([decade, count]) => ({ decade, count }))
      .sort((a, b) => a.decade.localeCompare(b.decade));
  }, [records]);

  const criticalCount = records.filter((h) => h.impact === "CRITICAL").length;
  const totalVolume = records.reduce((s, h) => s + h.volumeTonnes, 0);

  return (
    <AppShell>
      <PageHeader
        title="History & Reference"
        subtitle="Your detected-incident log, plus the NOAA reference repository used for precedent analysis and similarity matching."
      />

      <Panel title={`Detected Incidents (${liveIncidents.length})`} dense>
        <p className="mb-2 text-[13px] text-muted-foreground">
          Oil spills detected and confirmed in VARUNA. This log starts empty and grows each time you run
          Detect → Confirm — separate from the NOAA reference repository below.
        </p>
        {liveIncidents.length === 0 ? (
          <div className="rounded-sm border border-dashed border-border-strong bg-surface px-4 py-6 text-center">
            <p className="text-[13px] text-muted-foreground">No incidents detected yet.</p>
            <Link
              to="/detect"
              className="mt-2 inline-flex rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground"
            >
              Detect a spill
            </Link>
          </div>
        ) : null}
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {liveIncidents.slice(0, 8).map((incident) => {
            return (
              <li key={incident.id}>
                <Link
                  to="/incidents/$id"
                  params={{ id: incident.id }}
                  className="block rounded-sm border border-border bg-surface px-3 py-2.5 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="num text-[13px] font-semibold">{incident.id}</span>
                    <RiskBadge level={incident.risk} />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{incident.name}</p>
                  <p className="num mt-1 text-[11px] text-muted-foreground">
                    {new Date(incident.detectedAt).toUTCString().replace("GMT", "UTC")}
                  </p>
                  <StatusBadge status={incident.status} />
                </Link>
              </li>
            );
          })}
        </ul>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Records" value={records.length} hint="NOAA OR&R dataset" />
        <MetricCard label="Critical Cases" value={criticalCount} tone="critical" hint="Major spills" />
        <MetricCard
          label="Cumulative Volume"
          value={`${Math.round(totalVolume / 1000).toLocaleString()}k t`}
          hint="Across all records"
        />
        <MetricCard label="Regions" value={regions.length - 1} tone="primary" hint="Distinct marine regions" />
      </div>

      <Panel title="Incidents by Decade" dense>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byDecade} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="decade" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
              <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <ReBar dataKey="count" radius={[3, 3, 0, 0]} fill="var(--chart-2)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel title="Filters" dense>
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, location, oil type or cause"
            className="rounded-sm border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="rounded-sm border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          >
            {regions.map((r) => (
              <option key={r} value={r}>
                {r === "ALL" ? "All regions" : r}
              </option>
            ))}
          </select>
          <select
            value={impact}
            onChange={(e) => setImpact(e.target.value as RiskLevel | "ALL")}
            className="rounded-sm border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          >
            {IMPACTS.map((r) => (
              <option key={r} value={r}>
                {r === "ALL" ? "All impact levels" : r}
              </option>
            ))}
          </select>
        </div>
      </Panel>

      <Panel title={`NOAA Reference Repository (${rows.length})`} bodyClassName="p-0">
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No records match these filters"
              description="Adjust the search text, region or impact filter to widen the result set."
            />
          </div>
        ) : (
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border bg-surface text-left">
                  {["Incident", "Location", "Date", "Oil", "Volume", "Coastal Status", "Impact"].map((h) => (
                    <th key={h} className="label-caps bg-surface px-4 py-2.5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => (
                  <tr
                    key={h.id}
                    onClick={() => navigate({ to: "/history/$id", params: { id: h.id } })}
                    className="cursor-pointer border-b border-border/70 transition-colors hover:bg-accent/60"
                  >
                    <td className="px-4 py-2.5">
                      <span className="font-semibold">{h.name}</span>
                      <p className="text-xs text-muted-foreground">{h.persistence}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {h.location}
                      <p className="text-muted-foreground">{h.region}</p>
                    </td>
                    <td className="num px-4 py-2.5 text-xs">{h.date}</td>
                    <td className="px-4 py-2.5 text-xs">{h.oilType}</td>
                    <td className="num px-4 py-2.5">{h.volumeTonnes.toLocaleString()} t</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{h.coastalStatus}</td>
                    <td className="px-4 py-2.5">
                      <RiskBadge level={h.impact} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Disclaimer>{DISCLAIMERS.similarity}</Disclaimer>
    </AppShell>
  );
}
