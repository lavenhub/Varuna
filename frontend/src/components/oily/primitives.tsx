import { cn } from "@/lib/utils";
import type { DataQuality, RiskLevel } from "@/lib/oily/types";
import type { ReactNode } from "react";
import { Info } from "lucide-react";

export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
  dense,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  dense?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-md border border-border bg-card shadow-[var(--shadow-panel)]",
        className,
      )}
    >
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <h2 className="label-caps text-foreground/80">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className={cn(dense ? "p-3" : "p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  badges,
  action,
}: {
  title: string;
  subtitle?: string;
  badges?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {badges}
        </div>
        {subtitle ? (
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

const RISK_CLASS: Record<RiskLevel, string> = {
  LOW: "bg-safe-soft text-safe border-safe/30",
  MEDIUM: "bg-caution-soft text-warning border-warning/30",
  HIGH: "bg-warning-soft text-warning border-warning/40",
  CRITICAL: "bg-critical-soft text-critical border-critical/40",
};

export function RiskBadge({
  level,
  label,
  className,
}: {
  level: RiskLevel;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        RISK_CLASS[level],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {label ?? level}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const critical = ["ACTIVE", "RESPONDING", "DETECTED"].includes(status);
  const safe = ["CONTAINED", "CLOSED"].includes(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        critical
          ? "border-critical/40 bg-critical-soft text-critical"
          : safe
            ? "border-safe/30 bg-safe-soft text-safe"
            : "border-primary/30 bg-info-soft text-primary",
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

export function QualityBadge({ quality, title }: { quality: DataQuality; title?: string }) {
  return (
    <span
      title={title ?? DATA_STATUS_HELP[quality]}
      className={cn(
        "rounded-sm border px-1.5 py-px text-[10px] font-semibold tracking-wider",
        quality === "OBSERVED"
          ? "border-safe/30 bg-safe-soft text-safe"
          : quality === "MODELLED"
            ? "border-primary/30 bg-info-soft text-primary"
            : quality === "SIMULATED"
              ? "border-cyan/40 bg-cyan/10 text-cyan"
              : "border-border-strong bg-muted text-muted-foreground",
      )}
    >
      {quality}
    </span>
  );
}

export const DATA_STATUS_HELP: Record<DataQuality, string> = {
  OBSERVED: "Direct measurement / in-situ observation",
  MODELLED: "Numerical model output (e.g. NWP / ocean model)",
  ESTIMATED: "Derived estimate from indirect inputs",
  SIMULATED: "VARUNA simulation-engine output",
};

/** Subtle model-version chip (e.g. "varuna-drift-v1") for provenance. */
export function ModelBadge({ version, label }: { version: string; label?: string }) {
  return (
    <span
      title={label ? `${label}: ${version}` : version}
      className="num inline-flex items-center gap-1 rounded-sm border border-border-strong bg-muted px-1.5 py-px text-[10px] font-medium tracking-tight text-muted-foreground"
    >
      <span className="size-1.5 rounded-full bg-primary/60" />
      {version}
    </span>
  );
}

/**
 * Auditability panel: INPUTS -> MODEL -> OUTPUT. Lets a judge trace exactly
 * where a number came from (brief requirement). Purely presentational.
 */
export function AuditPanel({
  inputs,
  model,
  output,
}: {
  inputs: { label: string; value: ReactNode }[];
  model: ReactNode;
  output: { label: string; value: ReactNode }[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-md border border-border bg-surface p-3">
        <p className="label-caps mb-2 text-primary">Inputs</p>
        <dl className="space-y-1.5">
          {inputs.map((i) => (
            <div key={i.label} className="flex justify-between gap-3 text-xs">
              <dt className="text-muted-foreground">{i.label}</dt>
              <dd className="num text-right font-medium">{i.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex flex-col rounded-md border border-border bg-surface p-3">
        <p className="label-caps mb-2 text-primary">Model</p>
        <div className="flex flex-1 flex-col justify-center gap-1.5 text-xs">{model}</div>
      </div>
      <div className="rounded-md border border-border bg-surface p-3">
        <p className="label-caps mb-2 text-primary">Output</p>
        <dl className="space-y-1.5">
          {output.map((o) => (
            <div key={o.label} className="flex justify-between gap-3 text-xs">
              <dt className="text-muted-foreground">{o.label}</dt>
              <dd className="num text-right font-semibold">{o.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** Operational incident timeline (brief §19). */
export function Timeline({ items }: { items: { time: string; text: string }[] }) {
  return (
    <ol className="relative space-y-3 pl-5">
      <span className="absolute left-[6px] top-1 bottom-1 w-px bg-border" aria-hidden />
      {items.map((it, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[15px] top-1 size-2.5 rounded-full border-2 border-card bg-primary" />
          <p className="num text-[11px] font-semibold text-muted-foreground">{it.time}</p>
          <p className="text-sm">{it.text}</p>
        </li>
      ))}
    </ol>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "critical" | "warning" | "safe" | "primary";
}) {
  const toneClass = {
    default: "text-foreground",
    critical: "text-critical",
    warning: "text-warning",
    safe: "text-safe",
    primary: "text-primary",
  }[tone];
  return (
    <div className="group rounded-md border border-border bg-card p-4 shadow-[var(--shadow-panel)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--shadow-raised)]">
      <p className="label-caps">{label}</p>
      <p className={cn("num mt-1.5 text-2xl font-semibold leading-none transition-colors", toneClass)}>
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function DataRow({
  label,
  value,
  badge,
}: {
  label: string;
  value: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/70 py-2 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 text-right text-sm font-medium">
        {value}
        {badge}
      </span>
    </div>
  );
}

export function TelemetryCard({
  label,
  value,
  unit,
  quality = "OBSERVED",
}: {
  label: string;
  value: number | string | null;
  unit?: string;
  quality?: DataQuality;
}) {
  const unavailable = value === null || value === undefined || value === "";
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="label-caps">{label}</p>
        <QualityBadge quality={quality} />
      </div>
      {unavailable ? (
        <p className="mt-1 text-sm italic text-muted-foreground">Data unavailable</p>
      ) : (
        <p className="num mt-1 text-lg font-semibold">
          {value}
          {unit ? <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span> : null}
        </p>
      )}
    </div>
  );
}

export function Disclaimer({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-border bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function ScoreGauge({
  score,
  severity,
  confidence,
}: {
  score: number;
  severity: RiskLevel;
  confidence: number;
}) {
  const color =
    severity === "CRITICAL"
      ? "var(--critical)"
      : severity === "HIGH"
        ? "var(--warning)"
        : severity === "MEDIUM"
          ? "var(--caution)"
          : "var(--safe)";
  const r = 52;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-5">
      <div className="relative size-32 shrink-0">
        <svg viewBox="0 0 128 128" className="size-32 -rotate-90">
          <circle cx="64" cy="64" r={r} fill="none" stroke="var(--border)" strokeWidth="10" />
          <circle
            cx="64"
            cy="64"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - score / 100)}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-3xl font-semibold leading-none">{score}</span>
          <span className="text-[11px] text-muted-foreground">/ 100</span>
        </div>
      </div>
      <div>
        <RiskBadge level={severity} />
        <p className="num mt-3 text-sm">
          Confidence <span className="font-semibold">{confidence}%</span>
        </p>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          Model-based environmental severity / exposure estimate.
        </p>
      </div>
    </div>
  );
}

export function Bar({ value, tone }: { value: number; tone?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.min(100, value)}%`, background: tone ?? "var(--primary)" }}
      />
    </div>
  );
}

export function Chain({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-1">
      {steps.map((step, i) => (
        <li key={step + i} className="flex items-center gap-2 text-sm">
          <span
            className={cn(
              "num flex size-5 shrink-0 items-center justify-center rounded-sm border text-[10px]",
              i === steps.length - 1
                ? "border-critical/40 bg-critical-soft text-critical"
                : "border-border bg-muted text-muted-foreground",
            )}
          >
            {i === steps.length - 1 ? "!" : i + 1}
          </span>
          <span
            className={cn(
              i === steps.length - 1 ? "font-semibold text-critical" : "text-foreground",
            )}
          >
            {step}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border-strong bg-surface px-6 py-14 text-center">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
