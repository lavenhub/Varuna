import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Check, ImageUp, Loader2, RotateCcw, Upload } from "lucide-react";
import demoImage from "@/assets/demo-spill.jpg";
import { AppShell } from "@/components/oily/AppShell";
import {
  DataRow,
  Disclaimer,
  PageHeader,
  Panel,
  QualityBadge,
  RiskBadge,
} from "@/components/oily/primitives";
import { classifySpillImage } from "@/services/mlService";
import { oily } from "@/api";
import { oilyStore } from "@/lib/oily/store";
import { DISCLAIMERS } from "@/lib/oily/data";
import type { MLPrediction } from "@/lib/oily/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/detect")({
  head: () => ({
    meta: [
      { title: "Detect Oil Spill — Varuna Image Classification" },
      {
        name: "description",
        content:
          "Upload satellite or aerial imagery to identify potential oil-spill regions with the Varuna detection model.",
      },
      { property: "og:title", content: "Detect Oil Spill — Varuna" },
      {
        property: "og:description",
        content: "ML classification of satellite imagery for oil-spill detection.",
      },
    ],
  }),
  component: DetectPage,
});

type Stage = "upload" | "analyzing" | "result" | "confirm" | "logging";

const LOG_STEPS = [
  "Detection recorded",
  "Spill location recorded",
  "Spill characteristics saved",
  "Incident ID generated",
  "Environmental data linked",
  "Historical record created",
];

function DetectPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [stage, setStage] = useState<Stage>("upload");
  const [preview, setPreview] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState<string>("");
  const [prediction, setPrediction] = useState<MLPrediction | null>(null);
  const [logStep, setLogStep] = useState(0);
  const [newId, setNewId] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [form, setForm] = useState({
    name: "Arabian Sea Crude Oil Spill",
    lat: "21.100",
    lon: "72.910",
    oilType: "Crude Oil",
    volume: "420",
    cause: "Unknown",
    persistence: "Persistent",
    notes: "",
    confidence: "92.4",
    area: "12.6",
    source: "Satellite Image",
  });

  async function runClassification(meta: { name: string; size: number }, dataUrl: string) {
    setPreview(dataUrl);
    setFileLabel(meta.name);
    setStage("analyzing");
    const result = await classifySpillImage(meta, dataUrl);
    setPrediction(result);
    // Browsers can't render raw SAR uploads (e.g. multi-band GeoTIFF) inline —
    // swap in the model's rendered scene, which always displays. Prefer the
    // annotated version (real detected region baked in) over the plain preview.
    if (result.annotatedJpegBase64) {
      setPreview(`data:image/jpeg;base64,${result.annotatedJpegBase64}`);
    } else if (result.sourcePreviewPngBase64) {
      setPreview(`data:image/png;base64,${result.sourcePreviewPngBase64}`);
    }
    setForm((f) => ({
      ...f,
      confidence: (result.confidence * 100).toFixed(1),
      area: String(result.estimatedAreaKm2),
    }));
    setStage("result");
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      void runClassification({ name: file.name, size: file.size }, String(reader.result));
    };
    reader.readAsDataURL(file);
  }

  async function useDemoImage() {
    const response = await fetch(demoImage);
    const blob = await response.blob();
    const reader = new FileReader();
    reader.onload = () => {
      void runClassification({ name: "arabian-sea-sar-demo.jpg", size: blob.size }, String(reader.result));
    };
    reader.readAsDataURL(blob);
  }

  async function logIncident() {
    setStage("logging");
    const lat = Number(form.lat);
    const lon = Number(form.lon);
    // Persist the incident server-side. The backend generates the incident ID,
    // stores it in the database and (loadEnvironment) attaches a live
    // environmental snapshot from Open-Meteo — so the ID/telemetry are real
    // server state, not invented on the client.
    const createPromise = oily.incidents
      .create({
        name: form.name,
        lat,
        lon,
        oilType: form.oilType,
        persistence: form.persistence === "Persistent" ? "Persistent" : "Non-persistent",
        volumeTonnes: Number(form.volume),
        spillAreaKm2: Number(form.area),
        cause: form.cause,
        mlConfidence: Number(form.confidence) / 100,
        detectionSource: form.source,
        notes: form.notes,
        imageDataUrl: preview,
        loadEnvironment: true,
      })
      .catch((err: unknown) => {
        throw err instanceof Error ? err : new Error(String(err));
      });

    // Walk the visible logging steps while the server call is in flight.
    for (let i = 0; i < LOG_STEPS.length; i++) {
      await new Promise((r) => setTimeout(r, 360));
      setLogStep(i + 1);
    }

    try {
      const created = await createPromise;
      // Keep the annotated preview locally (the API doesn't round-trip huge images).
      const withImage = preview ? { ...created, imageDataUrl: preview } : created;
      setNewId(created.id);
      oilyStore.addIncident(withImage);
      await new Promise((r) => setTimeout(r, 500));
      navigate({ to: "/incidents/$id", params: { id: created.id } });
    } catch (err) {
      setLogError(err instanceof Error ? err.message : String(err));
    }
  }

  const detectedAt = new Date().toUTCString().replace("GMT", "UTC");

  return (
    <AppShell>
      <PageHeader
        title="Detect Oil Spill"
        subtitle="Upload satellite or aerial imagery to identify potential oil-spill regions."
        badges={<QualityBadge quality="MODELLED" />}
      />

      {stage === "upload" ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
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
              if (file) handleFile(file);
            }}
            className={cn(
              "flex min-h-[360px] flex-col items-center justify-center rounded-md border-2 border-dashed bg-card px-6 py-12 text-center transition-colors",
              dragging ? "border-primary bg-info-soft" : "border-border-strong",
            )}
          >
            <ImageUp className="size-9 text-primary" />
            <h2 className="mt-4 text-base font-semibold uppercase tracking-wide">
              Upload Spill Image
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Drag &amp; drop image here</p>
            <p className="my-3 text-xs text-muted-foreground">or</p>
            <button
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:brightness-110"
            >
              <Upload className="size-4" /> Browse Files
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <p className="mt-6 text-[11px] uppercase tracking-wider text-muted-foreground">
              PNG • JPG • JPEG
            </p>
          </div>

          <div className="space-y-4">
            <Panel title="Quick Demo" dense>
              <p className="text-[13px] text-muted-foreground">
                Run the pipeline immediately with a sample SAR scene from the Arabian Sea sector.
              </p>
              <img
                src={demoImage}
                alt="Sample synthetic aperture radar scene containing an oil slick"
                width={1024}
                height={1024}
                loading="lazy"
                className="mt-3 h-36 w-full rounded-sm border border-border object-cover"
              />
              <button
                onClick={useDemoImage}
                className="mt-3 w-full rounded-sm border border-primary bg-info-soft px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-primary hover:brightness-105"
              >
                Use Demo Image
              </button>
            </Panel>
            <Panel title="Detection Model" dense>
              <DataRow label="Model" value="Varuna Spill Detection v1" />
              <DataRow label="Input" value="Optical / SAR scene" />
              <DataRow label="Outputs" value="Class, confidence, segmentation" />
              <DataRow label="Endpoint" value={<span className="num text-xs">POST /api/ml/classify</span>} />
            </Panel>
            <Disclaimer>{DISCLAIMERS.general}</Disclaimer>
          </div>
        </div>
      ) : null}

      {stage !== "upload" && stage !== "logging" ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
          <Panel title="Detection Scene" dense bodyClassName="p-3">
            <div className="relative aspect-square w-full overflow-hidden rounded-sm border border-border bg-navy">
              {preview ? (
                <img src={preview} alt="Uploaded spill scene" className="size-full object-cover" />
              ) : null}
              {stage === "analyzing" ? (
                <div className="absolute inset-0 flex items-center justify-center bg-navy/60 text-navy-foreground">
                  <span className="flex items-center gap-2 text-sm">
                    <Loader2 className="size-4 animate-spin" /> Running segmentation…
                  </span>
                </div>
              ) : null}
            </div>
            <p className="num mt-2 text-[11px] text-muted-foreground">{fileLabel}</p>
          </Panel>

          <div className="space-y-4">
            <Panel title="ML Analysis" dense>
              <DataRow label="Model" value={prediction?.model ?? "Varuna Spill Detection v1"} />
              <DataRow
                label="Status"
                value={
                  stage === "analyzing" ? (
                    <span className="flex items-center gap-1.5 text-warning">
                      <Loader2 className="size-3.5 animate-spin" /> Analyzing…
                    </span>
                  ) : (
                    <span className="text-safe">Complete</span>
                  )
                }
              />
              <DataRow
                label="Confidence"
                value={prediction ? `${(prediction.confidence * 100).toFixed(1)}%` : "—"}
              />
              <DataRow
                label="Classification"
                value={
                  prediction
                    ? prediction.classification === "oil_spill"
                      ? "Potential Oil Spill"
                      : "Background / No spill"
                    : "—"
                }
              />
              <DataRow
                label="Spill probability"
                value={prediction ? `${(prediction.spillProbability * 100).toFixed(1)}%` : "—"}
              />
              <DataRow
                label="Background"
                value={prediction ? `${(prediction.backgroundProbability * 100).toFixed(1)}%` : "—"}
              />
              <DataRow
                label="Segmentation"
                value={prediction?.segmentationAvailable ? "Available" : "Unavailable"}
              />
            </Panel>

            {stage === "result" && prediction ? (
              <Panel
                title="Classification Result"
                action={<RiskBadge level="HIGH" label="Review required" />}
                dense
              >
                <h3 className="text-base font-semibold">
                  {prediction.classification === "oil_spill"
                    ? "Potential Oil Spill Detected"
                    : "No Spill Signature Detected"}
                </h3>
                <div className="mt-2">
                  <DataRow label="Confidence" value={`${(prediction.confidence * 100).toFixed(1)}%`} />
                  <DataRow label="Estimated spill area" value={`${prediction.estimatedAreaKm2} km²`} />
                  <DataRow label="Detection source" value="Uploaded Satellite Image" />
                  <DataRow label="Detection time" value={<span className="num text-xs">{detectedAt}</span>} />
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button
                    onClick={() => setStage("confirm")}
                    className="rounded-sm bg-critical px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-white hover:brightness-110"
                  >
                    Confirm Incident
                  </button>
                  <button
                    onClick={() => {
                      setStage("upload");
                      setPreview(null);
                      setPrediction(null);
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-sm border border-border-strong px-4 py-2.5 text-sm font-semibold uppercase tracking-wide hover:bg-accent"
                  >
                    <RotateCcw className="size-3.5" /> Reject Detection
                  </button>
                </div>
                <Disclaimer>
                  Classification is a model output. Confirm against operational observation before
                  logging an incident.
                </Disclaimer>
              </Panel>
            ) : null}

            {stage === "confirm" ? (
              <Panel title="Confirm Incident" dense>
                <p className="text-[13px] text-muted-foreground">
                  Values derived from the detection are pre-filled and editable.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["name", "Incident Name", "sm:col-span-2"],
                      ["lat", "Latitude"],
                      ["lon", "Longitude"],
                      ["oilType", "Oil Type"],
                      ["volume", "Estimated Volume (tonnes)"],
                      ["cause", "Cause"],
                      ["persistence", "Persistence"],
                      ["confidence", "Detection Confidence (%)"],
                      ["area", "Spill Area (km²)"],
                      ["source", "Detection Source", "sm:col-span-2"],
                    ] as const
                  ).map(([key, label, span]) => (
                    <div key={key} className={span}>
                      <label className="label-caps" htmlFor={key}>
                        {label}
                      </label>
                      <input
                        id={key}
                        value={form[key]}
                        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                        className="num mt-1 w-full rounded-sm border border-input bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                      />
                    </div>
                  ))}
                  <div className="sm:col-span-2">
                    <label className="label-caps" htmlFor="notes">
                      Notes
                    </label>
                    <textarea
                      id="notes"
                      rows={3}
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      className="mt-1 w-full rounded-sm border border-input bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                    />
                  </div>
                </div>
                <button
                  onClick={() => void logIncident()}
                  className="mt-4 w-full rounded-sm bg-primary px-4 py-3 text-sm font-bold uppercase tracking-wide text-primary-foreground hover:brightness-110"
                >
                  Confirm &amp; Log Incident
                </button>
              </Panel>
            ) : null}
          </div>
        </div>
      ) : null}

      {stage === "logging" ? (
        <Panel title="Incident Logging" className="mx-auto max-w-xl">
          <h2 className="text-base font-semibold">Creating incident…</h2>
          <ul className="mt-4 space-y-2">
            {LOG_STEPS.map((step, i) => (
              <li key={step} className="flex items-center gap-2 text-sm">
                {i < logStep ? (
                  <Check className="size-4 text-safe" />
                ) : (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                )}
                <span className={i < logStep ? "" : "text-muted-foreground"}>{step}</span>
              </li>
            ))}
          </ul>
          {logStep === LOG_STEPS.length && newId ? (
            <div className="mt-5 rounded-sm border border-safe/30 bg-safe-soft p-3">
              <p className="text-sm font-semibold text-safe">Incident successfully logged.</p>
              <p className="num mt-1 text-2xl font-semibold">{newId}</p>
              <p className="mt-1 text-xs text-muted-foreground">Opening incident command…</p>
            </div>
          ) : null}
          {logError ? (
            <div className="mt-5 rounded-sm border border-critical/40 bg-critical-soft p-3">
              <p className="text-sm font-semibold text-critical">Could not log incident.</p>
              <p className="mt-1 text-xs text-muted-foreground">{logError}</p>
              <button
                onClick={() => {
                  setLogError(null);
                  setStage("confirm");
                }}
                className="mt-3 rounded-sm border border-border-strong px-3 py-1.5 text-xs font-semibold uppercase tracking-wide hover:bg-accent"
              >
                Back to form
              </button>
            </div>
          ) : null}
        </Panel>
      ) : null}
    </AppShell>
  );
}
