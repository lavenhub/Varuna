import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Loader2, Radar, RefreshCw, Wind } from "lucide-react";
import { AppShell } from "@/components/oily/AppShell";
import { MapView, DEFAULT_LAYERS } from "@/components/oily/MapView";
import { MetricCard, Panel, RiskBadge, StatusBadge, Disclaimer } from "@/components/oily/primitives";
import { CountUp } from "@/components/oily/CountUp";
import { useOily } from "@/lib/oily/store";
import { buildIntelligence } from "@/lib/oily/engine";
import { compass } from "@/lib/oily/geo";
import { oilyApi } from "@/services/oilyApi";
import { DISCLAIMERS } from "@/lib/oily/data";
import { cn } from "@/lib/utils";

const LIVE_POLL_MS = 60_000;

/** Polls real current conditions for a coordinate every LIVE_POLL_MS — the
 * dashboard's "Live Ocean Conditions" widget genuinely refreshes on its own,
 * rather than showing a value fetched once and left static. */
function useLivePoll(lat: number | undefined, lon: number | undefined) {
  const [data, setData] = useState<Awaited<ReturnType<typeof oilyApi.liveTelemetry>> | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchNow = () => {
    if (lat === undefined || lon === undefined) return;
    setLoading(true);
    oilyApi
      .liveTelemetry(lat, lon)
      .then((d) => {
        setData(d);
        setUpdatedAt(new Date());
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchNow();
    const id = setInterval(fetchNow, LIVE_POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon]);

  return { data, updatedAt, loading, refresh: fetchNow };
}

function useTickingClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Command Center — Varuna Spill Operations Dashboard" },
      {
        name: "description",
        content:
          "Live oil-spill operations picture: active incidents, high-risk sectors, trajectories and the incident feed.",
      },
      { property: "og:title", content: "Varuna Command Center" },
      {
        property: "og:description",
        content: "Live operational picture of active oil-spill incidents and risk sectors.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { incidents, analyses, notifications } = useOily();
  const navigate = useNavigate();

  const intel = useMemo(
    () =>
      incidents.map((incident) => ({ incident, ...buildIntelligence(incident) })),
    [incidents],
  );

  const active = incidents.filter((i) => !["CLOSED", "CONTAINED"].includes(i.status));
  const highRisk = incidents.filter((i) => i.risk === "HIGH" || i.risk === "CRITICAL");
  const responding = incidents.filter((i) => i.status === "RESPONDING");
  // Real count: sensitive features intersected across all current trajectories.
  const areasAtRisk = intel.reduce(
    (n, row) => n + row.impact.exposures.filter((e) => e.hours != null).length,
    0,
  );
  const hero = intel[0];
  const clock = useTickingClock();
  const live = useLivePoll(hero?.incident.lat, hero?.incident.lon);

  const popupExtras = useMemo(() => {
    const out: Record<string, { drift?: string; coast?: string }> = {};
    for (const row of intel) {
      const coast = row.impact.exposures.find((e) => e.feature === "Coastline");
      out[row.incident.id] = {
        drift: `${row.forecast.speed.toFixed(2)} m/s ${compass(row.forecast.directionDeg)}`,
        coast: coast?.hours != null ? `${coast.hours}h` : "not intersected",
      };
    }
    return out;
  }, [intel]);

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">Operational Picture</h1>
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-safe/30 bg-safe-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-safe">
              <span className="size-1.5 animate-pulse rounded-full bg-safe" /> Live
            </span>
          </div>
          <p className="num mt-1 text-sm text-muted-foreground">
            {clock.toUTCString().replace("GMT", "UTC")} · monitored maritime sectors
          </p>
        </div>
        <button
          onClick={() => navigate({ to: "/detect" })}
          className="inline-flex items-center gap-2 rounded-sm bg-critical px-5 py-3 text-sm font-bold uppercase tracking-wider text-white shadow-[var(--shadow-panel)] hover:brightness-110"
        >
          <Radar className="size-4" /> Detect New Spill
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Detected Incidents" value={<CountUp end={incidents.length} />} hint="Confirmed in VARUNA" />
        <MetricCard label="Active Incidents" value={<CountUp end={active.length} />} hint="Not contained/closed" />
        <MetricCard label="High Risk" value={<CountUp end={highRisk.length} />} tone="critical" hint="HIGH or CRITICAL severity" />
        <MetricCard label="Under Response" value={<CountUp end={responding.length} />} tone="warning" hint="Teams deployed" />
        <MetricCard label="Areas at Risk" value={<CountUp end={areasAtRisk} />} tone="warning" hint="Sensitive features in trajectories" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Panel
          title="Global Incident Map"
          action={
            <span className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              {[
                ["CRITICAL", "#dc2626"],
                ["HIGH", "#ea580c"],
                ["MEDIUM", "#d97706"],
                ["LOW", "#15803d"],
              ].map(([label, color]) => (
                <span key={label} className="flex items-center gap-1">
                  <span className="size-2 rounded-full" style={{ background: color }} />
                  {label}
                </span>
              ))}
            </span>
          }
          bodyClassName="p-0"
        >
          <MapView
            className="h-[420px] rounded-none border-0 xl:h-[520px]"
            incidents={incidents}
            trajectory={hero?.forecast.points}
            spillFor={hero?.incident}
            layers={DEFAULT_LAYERS}
            popupExtras={popupExtras}
            onSelect={(id) => navigate({ to: "/incidents/$id", params: { id } })}
          />
        </Panel>

        <div className="space-y-4">
          {hero?.incident.imageDataUrl ? (
            <Panel title="Latest Detection" dense>
              <Link to="/incidents/$id" params={{ id: hero.incident.id }}>
                <img
                  src={hero.incident.imageDataUrl}
                  alt={`Analyzed scene for ${hero.incident.id}`}
                  className="aspect-square w-full rounded-sm border border-border object-cover"
                />
              </Link>
              <div className="mt-2 flex items-center justify-between">
                <span className="num text-[13px] font-semibold">{hero.incident.id}</span>
                <RiskBadge level={hero.impact.severity} />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{hero.incident.name}</p>
              <p className="num mt-1 text-[11px]">
                {(hero.incident.mlConfidence * 100).toFixed(1)}% confidence ·{" "}
                {hero.incident.spillAreaKm2} km²
              </p>
            </Panel>
          ) : null}

          {hero ? (
            <Panel
              title="Live Ocean Conditions"
              action={
                <button
                  onClick={live.refresh}
                  disabled={live.loading}
                  className="flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50"
                >
                  {live.loading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                  Refresh
                </button>
              }
              dense
            >
              {live.data ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-sm border border-border bg-surface px-2.5 py-2">
                      <p className="label-caps flex items-center gap-1"><Wind className="size-3" /> Wind</p>
                      <p className="num mt-1 text-sm font-semibold">
                        {live.data.windSpeed} m/s {compass(live.data.windDirection)}
                      </p>
                    </div>
                    <div className="rounded-sm border border-border bg-surface px-2.5 py-2">
                      <p className="label-caps">Current</p>
                      <p className="num mt-1 text-sm font-semibold">
                        {live.data.currentSpeed} m/s {compass(live.data.currentDirection)}
                      </p>
                    </div>
                    <div className="rounded-sm border border-border bg-surface px-2.5 py-2">
                      <p className="label-caps">Wave</p>
                      <p className="num mt-1 text-sm font-semibold">{live.data.waveHeight} m</p>
                    </div>
                    <div className="rounded-sm border border-border bg-surface px-2.5 py-2">
                      <p className="label-caps">Sea temp</p>
                      <p className="num mt-1 text-sm font-semibold">{live.data.temperature}°C</p>
                    </div>
                  </div>
                  <p className="num mt-2 text-[10px] text-muted-foreground">
                    At {hero.incident.id}'s location · updated{" "}
                    {live.updatedAt?.toLocaleTimeString()} · auto-refreshes every 60s
                  </p>
                </>
              ) : (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Fetching live conditions…
                </div>
              )}
            </Panel>
          ) : null}

          {analyses.length > 0 ? (
            <Panel title="Recent Analysis Activity" dense>
              <p className="mb-2 text-[11px] text-muted-foreground">
                Live results from the Impact & Drift tabs — updates the moment a tab recomputes from
                fetched data.
              </p>
              <ul className="space-y-2">
                {analyses.slice(0, 5).map((a) => (
                  <li key={a.id}>
                    <Link
                      to={a.kind === "impact" ? "/impact" : "/drift"}
                      search={{ incident: a.incidentId }}
                      className="block rounded-sm border border-border bg-surface px-3 py-2 transition-colors hover:border-primary/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "rounded-sm px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                            a.kind === "impact" ? "bg-info-soft text-primary" : "bg-safe-soft text-safe",
                          )}
                        >
                          {a.kind}
                        </span>
                        <span className="num text-[10px] text-muted-foreground">
                          {new Date(a.at).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="num mt-1 text-[13px] font-semibold">{a.summary}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {a.incidentId} · {a.detail}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel title="Live Incident Feed" dense>
            {notifications.length === 0 ? (
              <p className="py-2 text-[13px] text-muted-foreground">
                No incidents logged yet. Detect a spill to populate the feed.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {notifications.slice(0, 8).map((item) => (
                  <li key={item.id} className="flex gap-2.5">
                    <span className="num shrink-0 text-xs text-muted-foreground">{item.time}</span>
                    <span
                      className={cn(
                        "mt-1.5 size-1.5 shrink-0 rounded-full",
                        item.level === "critical"
                          ? "bg-critical"
                          : item.level === "warning"
                            ? "bg-warning"
                            : item.level === "safe"
                              ? "bg-safe"
                              : "bg-primary",
                      )}
                    />
                    <span className="text-[13px] leading-snug">{item.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Priority Incidents" dense>
            {intel.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-[13px] text-muted-foreground">No incidents detected yet.</p>
                <Link
                  to="/detect"
                  className="mt-2 inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground"
                >
                  <Radar className="size-3.5" /> Detect a spill
                </Link>
              </div>
            ) : null}
            <ul className="space-y-2">
              {intel
                .slice()
                .sort((a, b) => b.impact.score - a.impact.score)
                .slice(0, 4)
                .map(({ incident, impact, forecast }) => {
                  const coast = impact.exposures.find((e) => e.feature === "Coastline");
                  return (
                    <li key={incident.id}>
                      <Link
                        to="/incidents/$id"
                        params={{ id: incident.id }}
                        className="block rounded-sm border border-border bg-surface px-3 py-2.5 transition-colors hover:border-primary/40"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="num text-[13px] font-semibold">{incident.id}</span>
                          <RiskBadge level={impact.severity} />
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{incident.name}</p>
                        <p className="num mt-1 text-[11px]">
                          {forecast.speed.toFixed(2)} m/s {compass(forecast.directionDeg)} ·
                          coastline {coast?.hours != null ? `${coast.hours}h` : "—"} · {impact.score}/100
                        </p>
                        <StatusBadge status={incident.status} />
                      </Link>
                    </li>
                  );
                })}
            </ul>
            <Link
              to="/incidents"
              className="mt-3 flex items-center justify-center gap-1.5 rounded-sm border border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide hover:bg-accent"
            >
              All incidents <ArrowUpRight className="size-3.5" />
            </Link>
          </Panel>
        </div>
      </div>

      <Disclaimer>{DISCLAIMERS.general}</Disclaimer>
    </AppShell>
  );
}
