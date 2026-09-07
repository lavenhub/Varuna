import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Check, ImageUp, Loader2, Move3d, Pause, Play, RotateCcw, Upload } from "lucide-react";
import demoSarImage from "@/assets/demo-spill.jpg";
import { AppShell } from "@/components/oily/AppShell";
import {
  DataRow,
  Disclaimer,
  PageHeader,
  Panel,
  RiskBadge,
  TelemetryCard,
} from "@/components/oily/primitives";
import { useOily } from "@/lib/oily/store";
import { buildIntelligence } from "@/lib/oily/engine";
import { compass, formatCoord } from "@/lib/oily/geo";
import { DISCLAIMERS } from "@/lib/oily/data";
import { extractSlickContour } from "@/lib/oily/sarShape";
import { cn } from "@/lib/utils";

const OilSpill3D = lazy(() => import("@/components/oily/OilSpill3D"));

type SarState =
  | { status: "idle" }
  | { status: "analyzing"; preview: string }
  | {
      status: "matched";
      preview: string;
      maskPreview: string;
      areaFraction: number;
      shapePoints: [number, number][];
    }
  | { status: "unmatched"; preview: string };

export const Route = createFileRoute("/digital-twin")({
  head: () => ({
    meta: [
      { title: "Digital Twin — Varuna Spill Intelligence" },
      {
        name: "description",
        content:
          "Interactive 3D digital twin of an oil spill on water: replay the modelled slick spread across the forecast horizon.",
      },
      { property: "og:title", content: "Digital Twin — Varuna" },
      {
        property: "og:description",
        content: "3D simulation of an oil slick spreading on water over the 72-hour forecast.",
      },
    ],
  }),
  component: DigitalTwinPage,
});

function Scene3DFallback() {
  return (
    <div className="flex h-full items-center justify-center bg-navy">
      <span className="label-caps text-navy-muted">Loading 3D simulation…</span>
    </div>
  );
}

function DigitalTwinPage() {
  const { incidents } = useOily();
  const [incidentId, setIncidentId] = useState<string>(incidents[0]?.id ?? "");
  const incident = incidents.find((i) => i.id === incidentId) ?? incidents[0];
  const intel = useMemo(() => (incident ? buildIntelligence(incident) : null), [incident]);
  const points = intel?.forecast.points ?? [];

  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sar, setSar] = useState<SarState>({ status: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setStep(0);
    setSar({ status: "idle" });
  }, [incidentId]);

  function analyzeImageUrl(url: string) {
    setSar({ status: "analyzing", preview: url });
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const result = extractSlickContour(img);
      if (result) {
        setSar({
          status: "matched",
          preview: url,
          maskPreview: result.maskPreviewDataUrl,
          areaFraction: result.areaFraction,
          shapePoints: result.points,
        });
      } else {
        setSar({ status: "unmatched", preview: url });
      }
    };
    img.onerror = () => setSar({ status: "unmatched", preview: url });
    img.src = url;
  }

  function analyzeFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => analyzeImageUrl(String(reader.result));
    reader.readAsDataURL(file);
  }

  const shapePoints = sar.status === "matched" ? sar.shapePoints : null;

  useEffect(() => {
    if (!playing || points.length === 0) return;
    const id = setInterval(() => {
      setStep((s) => {
        if (s >= points.length - 1) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, 1400);
    return () => clearInterval(id);
  }, [playing, points.length]);

  if (!incident || !intel) {
    return (
      <AppShell>
        <PageHeader title="Digital Twin" subtitle="No incidents available to simulate." />
      </AppShell>
    );
  }

  const current = points[step] ?? points[0]!;
  const t = incident.telemetry;

  return (
    <AppShell>
      <PageHeader
        title="Digital Twin"
        subtitle="Interactive 3D simulation of the modelled oil slick spreading on water."
        badges={<RiskBadge level={intel.impact.severity} />}
        action={
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
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Panel title="3D Spill Simulation" bodyClassName="p-0">
            <div className="relative h-[480px] overflow-hidden rounded-none bg-navy">
              <ClientOnly fallback={<Scene3DFallback />}>
                <Suspense fallback={<Scene3DFallback />}>
                  <OilSpill3D
                    key={`${incident.id}-${shapePoints ? "sar" : "default"}`}
                    points={points}
                    step={step}
                    spillAreaKm2={incident.spillAreaKm2}
                    intensity={intel.impact.score / 100}
                    shapePoints={shapePoints}
                  />
                </Suspense>
              </ClientOnly>
              <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-sm border border-white/15 bg-navy/70 px-2 py-1 text-[10px] uppercase tracking-wider text-navy-foreground">
                <Move3d className="size-3.5 text-cyan" /> Drag to orbit · scroll to zoom
              </div>
              <div className="pointer-events-none absolute right-3 top-3 rounded-sm border border-white/15 bg-navy/70 px-2 py-1 text-[10px] text-navy-foreground">
                <span className="num">{current.hours === 0 ? "T = Now" : `T + ${current.hours} h`}</span>
              </div>
              {shapePoints ? (
                <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-sm border border-safe/30 bg-navy/70 px-2 py-1 text-[10px] text-safe">
                  <Check className="size-3.5" /> Slick shaped from uploaded SAR image
                </div>
              ) : null}
            </div>
          </Panel>

          <Panel title="Upload SAR / Satellite Image" dense>
            <p className="mb-3 text-[13px] text-muted-foreground">
              Upload a SAR or optical scene to shape the 3D slick like the actual imagery, instead of
              a generic footprint. Analysis runs entirely in your browser.
            </p>
            <button
              onClick={() => analyzeImageUrl(demoSarImage)}
              className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-sm border border-primary bg-info-soft px-3 py-2 text-xs font-semibold uppercase tracking-wide text-primary hover:brightness-105"
            >
              <ImageUp className="size-3.5" /> Use Demo SAR Image
            </button>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) analyzeFile(file);
              }}
              className={cn(
                "flex min-h-[120px] flex-col items-center justify-center rounded-md border-2 border-dashed bg-surface px-4 py-6 text-center transition-colors",
                dragging ? "border-primary bg-info-soft" : "border-border-strong",
              )}
            >
              <ImageUp className="size-6 text-primary" />
              <p className="mt-2 text-xs text-muted-foreground">Drag &amp; drop a SAR/optical image</p>
              <button
                onClick={() => inputRef.current?.click()}
                className="mt-2 inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
              >
                <Upload className="size-3.5" /> Browse Files
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) analyzeFile(file);
                }}
              />
            </div>

            {sar.status !== "idle" ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="label-caps mb-1">Uploaded scene</p>
                  <img
                    src={sar.preview}
                    alt="Uploaded SAR or optical scene"
                    className="h-32 w-full rounded-sm border border-border object-cover"
                  />
                </div>
                <div>
                  <p className="label-caps mb-1">Detected region</p>
                  {sar.status === "analyzing" ? (
                    <div className="flex h-32 items-center justify-center rounded-sm border border-border bg-muted/50">
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" /> Analyzing…
                      </span>
                    </div>
                  ) : sar.status === "matched" ? (
                    <img
                      src={sar.maskPreview}
                      alt="Detected slick region overlay"
                      className="h-32 w-full rounded-sm border border-border object-cover"
                    />
                  ) : (
                    <div className="flex h-32 items-center justify-center rounded-sm border border-dashed border-border bg-muted/50 px-2 text-center text-[11px] text-muted-foreground">
                      No clear slick contour detected — using default footprint.
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {sar.status === "matched" ? (
              <div className="mt-3 flex items-center justify-between gap-2 rounded-sm border border-safe/30 bg-safe-soft px-3 py-2 text-xs text-safe">
                <span className="flex items-center gap-1.5">
                  <Check className="size-3.5" /> Matched — detected slick covers ~
                  {Math.round(sar.areaFraction * 100)}% of the scene
                </span>
                <button
                  onClick={() => setSar({ status: "idle" })}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-safe underline-offset-2 hover:underline"
                >
                  <RotateCcw className="size-3" /> Reset
                </button>
              </div>
            ) : null}
          </Panel>

          <Panel title="Timeline Control" dense>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  if (step >= points.length - 1) setStep(0);
                  setPlaying((p) => !p);
                }}
                className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground hover:brightness-110"
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={points.length - 1}
                step={1}
                value={step}
                onChange={(e) => {
                  setPlaying(false);
                  setStep(Number(e.target.value));
                }}
                className="w-full accent-[var(--primary)]"
              />
              <span className="num w-16 shrink-0 text-right text-sm font-semibold">
                {current.hours === 0 ? "Now" : `T+${current.hours}h`}
              </span>
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
              {points.map((p, i) => (
                <span key={p.hours} className={i === step ? "font-semibold text-primary" : ""}>
                  {p.hours === 0 ? "0" : `${p.hours}h`}
                </span>
              ))}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="State at Timestep" dense>
            <DataRow label="Lead time" value={current.hours === 0 ? "Now" : `T+${current.hours} h`} />
            <DataRow label="Position" value={formatCoord(current.lat, current.lon)} />
            <DataRow label="Distance travelled" value={`${current.distanceKm.toFixed(1)} km`} />
            <DataRow label="Uncertainty" value={`± ${current.uncertaintyKm.toFixed(1)} km`} />
            <DataRow label="Slick area" value={`${incident.spillAreaKm2} km²`} />
            <DataRow
              label="Drift"
              value={`${intel.forecast.speed.toFixed(2)} m/s ${compass(intel.forecast.directionDeg)}`}
            />
          </Panel>

          <Panel title="Environmental Telemetry" dense>
            <div className="grid grid-cols-2 gap-2">
              <TelemetryCard label="Current" value={t.currentSpeed} unit="m/s" />
              <TelemetryCard label="Wind" value={t.windSpeed} unit="m/s" />
              <TelemetryCard label="Wave" value={t.waveHeight} unit="m" />
              <TelemetryCard label="Sea temp" value={t.temperature} unit="°C" />
            </div>
          </Panel>

          <Panel title="Exposure Watch" dense>
            <ul className="space-y-2">
              {intel.impact.exposures.map((e) => {
                const reached = e.hours != null && current.hours >= e.hours;
                return (
                  <li key={e.feature} className="flex items-center justify-between gap-2 text-sm">
                    <span className={reached ? "font-semibold text-critical" : ""}>{e.feature}</span>
                    <span className="num flex items-center gap-2 text-xs">
                      {e.hours != null ? `${e.hours} h` : "—"}
                      {reached ? <RiskBadge level={e.severity} label="reached" /> : <RiskBadge level={e.severity} />}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </div>

      <Disclaimer>{DISCLAIMERS.drift}</Disclaimer>
    </AppShell>
  );
}
