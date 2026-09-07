import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Clock, Loader2 } from "lucide-react";
import { AppShell } from "@/components/oily/AppShell";
import { AnalysisSteps } from "@/components/oily/AnalysisSteps";
import { IncidentSelector, IncidentSummaryStrip } from "@/components/oily/IncidentSelector";
import {
  Chain,
  DataRow,
  Disclaimer,
  ModelBadge,
  PageHeader,
  Panel,
  RiskBadge,
} from "@/components/oily/primitives";
import { useIncident } from "@/lib/oily/store";
import { oily, type ResponsePlanModel } from "@/api";
import { DISCLAIMERS } from "@/lib/oily/data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/response")({
  validateSearch: (search: Record<string, unknown>): { incident?: string } => {
    const incident = typeof search["incident"] === "string" ? (search["incident"] as string) : undefined;
    return incident ? { incident } : {};
  },
  head: () => ({
    meta: [
      { title: "Emergency Response — Varuna Spill Intelligence" },
      {
        name: "description",
        content:
          "Deterministic, rule-based ranked action plan with reasoning, manpower estimates and resource recommendations matched against a live inventory.",
      },
    ],
  }),
  component: ResponsePage,
});

const AVAIL_CLASS: Record<string, string> = {
  AVAILABLE: "text-safe",
  LIMITED: "text-warning",
  UNAVAILABLE: "text-critical",
  UNKNOWN: "text-muted-foreground",
};

const RESPONSE_STEPS = [
  "Loading incident + environmental field",
  "Running drift simulation for exposure timing",
  "Applying response rules (coastline / habitat / spread)",
  "Matching actions against the resource inventory",
];

function ResponsePage() {
  const { incident: incidentId } = Route.useSearch();
  const navigate = useNavigate();
  const incident = useIncident(incidentId);
  const [sel, setSel] = useState<string | undefined>(incidentId);
  const [state, setState] = useState<
    { s: "idle" } | { s: "loading" } | { s: "ok"; plan: ResponsePlanModel } | { s: "error"; msg: string }
  >({ s: "idle" });

  useEffect(() => {
    if (!incident) return;
    let cancelled = false;
    setState({ s: "loading" });
    oily.response
      .generate(incident.id)
      .then((plan) => !cancelled && setState({ s: "ok", plan }))
      .catch((e: unknown) => !cancelled && setState({ s: "error", msg: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [incident]);

  if (!incident) {
    return (
      <AppShell>
        <PageHeader
          title="Emergency Response"
          subtitle="Select an incident to generate a ranked, rule-based immediate action plan."
        />
        <IncidentSelector
          selectedId={sel}
          onSelect={setSel}
          ctaLabel="Generate Response Plan"
          onConfirm={() => sel && navigate({ to: "/response", search: { incident: sel } })}
        />
        <Disclaimer>{DISCLAIMERS.general}</Disclaimer>
      </AppShell>
    );
  }

  const plan = state.s === "ok" ? state.plan : null;

  return (
    <AppShell>
      <PageHeader
        title="Emergency Response"
        subtitle={`${incident.id} — ${incident.name}`}
        badges={
          <div className="flex items-center gap-2">
            {plan ? <RiskBadge level={plan.priority} label={`${plan.priority} priority`} /> : null}
            {plan ? <ModelBadge version={plan.modelVersion} label="Response engine" /> : null}
          </div>
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
            <button
              onClick={() => navigate({ to: "/response", search: {} })}
              className="rounded-sm border border-border-strong px-4 py-2.5 text-sm font-semibold uppercase tracking-wide hover:bg-accent"
            >
              Change incident
            </button>
          </div>
        }
      />

      <IncidentSummaryStrip incident={incident} />

      {state.s === "loading" || state.s === "idle" ? (
        <AnalysisSteps steps={RESPONSE_STEPS} activeStep={2} title="Generating response plan" />
      ) : state.s === "error" ? (
        <Disclaimer>Response engine unreachable ({state.msg}). Ensure the VARUNA backend is running.</Disclaimer>
      ) : null}

      {plan ? (
        <>
          <Panel title="Plan Summary">
            <p className="text-sm leading-relaxed">{plan.summary}</p>
          </Panel>

          <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
            <div className="space-y-4">
              <Panel title="Ranked Actions (deterministic rule engine)" dense>
                <ol className="space-y-3">
                  {plan.actions.map((action) => (
                    <li key={action.rank} className="rounded-md border border-border bg-surface p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
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
                      <p className="mt-2 text-[13px] text-muted-foreground">{action.reason}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {action.resources.map((r) => (
                          <span key={r} className="rounded-sm border border-border bg-muted px-2 py-0.5 text-[11px]">
                            {r}
                          </span>
                        ))}
                      </div>
                      <div className="mt-3 border-t border-border/70 pt-3">
                        <p className="label-caps mb-1.5">Reasoning chain</p>
                        <Chain steps={action.chain} />
                      </div>
                    </li>
                  ))}
                </ol>
              </Panel>
            </div>

            <div className="space-y-4">
              <Panel title="Situation" dense>
                {plan.situation.map((s) => (
                  <DataRow key={s.label} label={s.label} value={s.value} />
                ))}
              </Panel>

              <Panel
                title="Manpower Estimate"
                action={<span className="num text-sm font-semibold">{plan.manpower.total} total</span>}
                dense
              >
                {plan.manpower.roles.map((r) => (
                  <DataRow key={r.role} label={r.role} value={`${r.personnel} personnel`} />
                ))}
                <Disclaimer>{DISCLAIMERS.manpower}</Disclaimer>
              </Panel>

              <Panel title="Resource Recommendations vs Inventory" dense>
                <ul className="space-y-2">
                  {plan.resources.map((r) => (
                    <li key={r.resource} className="rounded-sm border border-border bg-surface px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium">{r.resource}</span>
                        <span className="num text-sm font-semibold text-primary">{r.recommended}</span>
                      </div>
                      <p className={cn("num mt-0.5 text-[11px]", AVAIL_CLASS[r.availability] ?? "text-muted-foreground")}>
                        {r.available}
                      </p>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </div>
        </>
      ) : null}

      <Disclaimer>{DISCLAIMERS.general}</Disclaimer>
    </AppShell>
  );
}
