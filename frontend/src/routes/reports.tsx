import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { AppShell } from "@/components/oily/AppShell";
import {
  DataRow,
  Disclaimer,
  PageHeader,
  Panel,
  RiskBadge,
} from "@/components/oily/primitives";
import { OilyMark } from "@/components/oily/OilyMark";
import { useOily } from "@/lib/oily/store";
import { buildIntelligence } from "@/lib/oily/engine";
import { compass, formatCoord } from "@/lib/oily/geo";
import { DISCLAIMERS } from "@/lib/oily/data";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Varuna Spill Intelligence" },
      {
        name: "description",
        content:
          "Generate a printable incident intelligence report covering detection, drift, impact and response.",
      },
      { property: "og:title", content: "Reports — Varuna" },
      {
        property: "og:description",
        content: "Printable oil-spill incident intelligence report.",
      },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const { incidents } = useOily();
  const [incidentId, setIncidentId] = useState<string>(incidents[0]?.id ?? "");
  const incident = incidents.find((i) => i.id === incidentId) ?? incidents[0];
  const intel = useMemo(() => (incident ? buildIntelligence(incident) : null), [incident]);

  if (!incident || !intel) {
    return (
      <AppShell>
        <PageHeader title="Reports" subtitle="No incidents available to report on." />
      </AppShell>
    );
  }

  const { forecast, impact, plan } = intel;
  const coast = impact.exposures.find((e) => e.feature === "Coastline");
  const generatedAt = new Date().toUTCString().replace("GMT", "UTC");

  return (
    <AppShell>
      <div className="print:hidden">
        <PageHeader
          title="Incident Report"
          subtitle="Generate a printable intelligence brief for a selected incident."
          action={
            <div className="flex flex-wrap gap-2">
              <select
                value={incidentId}
                onChange={(e) => setIncidentId(e.target.value)}
                className="rounded-sm border border-input bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary"
              >
                {incidents.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.id} — {i.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-primary-foreground hover:brightness-110"
              >
                <Printer className="size-4" /> Print / Save PDF
              </button>
            </div>
          }
        />
      </div>

      <article className="mx-auto max-w-4xl space-y-4 rounded-md border border-border bg-card p-6 shadow-[var(--shadow-panel)] print:border-0 print:shadow-none">
        <header className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div className="flex items-center gap-2.5">
            <OilyMark className="size-8" />
            <div>
              <p className="text-base font-semibold tracking-[0.14em]">VARUNA</p>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Oil Spill Intelligence Report
              </p>
            </div>
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            <p className="num">{incident.id}</p>
            <p className="num">Generated {generatedAt}</p>
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{incident.name}</h1>
          <RiskBadge level={impact.severity} label={`${impact.severity} priority`} />
        </div>

        <section>
          <h2 className="label-caps mb-1.5 text-foreground/80">1 · Situation</h2>
          <div className="grid gap-x-6 sm:grid-cols-2">
            <DataRow label="Location" value={`${formatCoord(incident.lat, incident.lon)} · ${incident.region}`} />
            <DataRow label="Detected" value={new Date(incident.detectedAt).toUTCString().replace("GMT", "UTC")} />
            <DataRow label="Oil type" value={`${incident.persistence} ${incident.oilType}`} />
            <DataRow label="Volume" value={`${incident.volumeTonnes.toLocaleString()} t`} />
            <DataRow label="Spill area" value={`${incident.spillAreaKm2} km²`} />
            <DataRow label="Cause" value={incident.cause} />
            <DataRow label="Detection source" value={incident.detectionSource} />
            <DataRow label="ML confidence" value={`${(incident.mlConfidence * 100).toFixed(1)}%`} />
          </div>
        </section>

        <section>
          <h2 className="label-caps mb-1.5 text-foreground/80">2 · Drift Forecast</h2>
          <div className="grid gap-x-6 sm:grid-cols-2">
            <DataRow label="Drift" value={`${forecast.speed.toFixed(2)} m/s ${compass(forecast.directionDeg)}`} />
            <DataRow label="Windage coefficient" value={forecast.windageCoefficient} />
            <DataRow
              label="72 h displacement"
              value={`${forecast.points[forecast.points.length - 1]!.distanceKm.toFixed(1)} km`}
            />
            <DataRow label="Coastline exposure" value={coast?.hours != null ? `${coast.hours} h` : "Not intersected"} />
          </div>
        </section>

        <section>
          <h2 className="label-caps mb-1.5 text-foreground/80">3 · Environmental Impact</h2>
          <p className="mb-2 text-sm">
            Severity <strong className="num">{impact.score}/100</strong> ({impact.severity}), confidence{" "}
            <strong className="num">{impact.confidence}%</strong>.
          </p>
          <div className="grid gap-x-6 sm:grid-cols-2">
            {impact.components.map((c) => (
              <DataRow key={c.label} label={c.label} value={`${c.value} — ${c.note}`} />
            ))}
          </div>
          <p className="mt-2 text-[11px] uppercase tracking-wider text-muted-foreground">Exposure estimates</p>
          <div className="grid gap-x-6 sm:grid-cols-2">
            {impact.exposures.map((e) => (
              <DataRow
                key={e.feature}
                label={e.feature}
                value={e.hours != null ? `${e.hours} h (${e.distanceKm} km) · ${e.severity}` : "Not intersected"}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="label-caps mb-1.5 text-foreground/80">4 · Recommended Response</h2>
          <p className="mb-2 text-sm leading-relaxed">{plan.summary}</p>
          <ol className="space-y-2">
            {plan.actions.map((a) => (
              <li key={a.rank} className="rounded-sm border border-border bg-surface p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">
                    {a.rank}. {a.title}
                  </span>
                  <span className="num text-[11px] uppercase tracking-wider text-critical">{a.timing}</span>
                </div>
                <p className="mt-1 text-[13px] text-muted-foreground">{a.action}</p>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h2 className="label-caps mb-1.5 text-foreground/80">5 · Resources & Manpower</h2>
          <div className="grid gap-x-6 sm:grid-cols-2">
            {plan.resources.map((r) => (
              <DataRow key={r.resource} label={r.resource} value={`${r.recommended} (${r.available})`} />
            ))}
            <DataRow label="Total personnel" value={`${plan.manpower.total}`} />
          </div>
        </section>

        <Disclaimer>{DISCLAIMERS.general}</Disclaimer>
        <p className="text-center text-[11px] text-muted-foreground">
          © 2026 Varuna — Oil Spill Intelligence &amp; Emergency Response
        </p>
      </article>
    </AppShell>
  );
}
