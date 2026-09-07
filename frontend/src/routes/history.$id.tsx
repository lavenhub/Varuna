import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/oily/AppShell";
import { MapView, DEFAULT_LAYERS } from "@/components/oily/MapView";
import {
  DataRow,
  Disclaimer,
  EmptyState,
  PageHeader,
  Panel,
  RiskBadge,
} from "@/components/oily/primitives";
import { oily, type HistoricalRecord } from "@/api";
import { DISCLAIMERS } from "@/lib/oily/data";
import { formatCoord } from "@/lib/oily/geo";

export const Route = createFileRoute("/history/$id")({
  head: () => ({
    meta: [
      { title: "Historical Incident — Varuna Spill Repository" },
      {
        name: "description",
        content: "Full record of a historical oil-spill incident: cause, response and outcome.",
      },
      { property: "og:title", content: "Historical Incident — Varuna" },
      { property: "og:description", content: "Record of a past oil-spill incident." },
    ],
  }),
  component: HistoryDetail,
});

function HistoryDetail() {
  const { id } = useParams({ from: "/history/$id" });
  const [state, setState] = useState<
    { s: "loading" } | { s: "ok"; record: HistoricalRecord } | { s: "missing" }
  >({ s: "loading" });

  useEffect(() => {
    let cancelled = false;
    oily.history
      .get(id)
      .then((record) => !cancelled && setState({ s: "ok", record }))
      .catch(() => !cancelled && setState({ s: "missing" }));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.s === "loading") {
    return (
      <AppShell>
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading historical record…
        </div>
      </AppShell>
    );
  }

  if (state.s === "missing") {
    return (
      <AppShell>
        <EmptyState
          title="Record not found"
          description="This historical incident is not present in the repository."
          action={
            <Link
              to="/history"
              className="rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Back to repository
            </Link>
          }
        />
      </AppShell>
    );
  }

  const record = state.record;
  const marker: [number, number] = [record.lat, record.lon];

  return (
    <AppShell>
      <PageHeader
        title={record.name}
        subtitle={`${record.location} · ${record.region} · ${record.date}`}
        badges={<RiskBadge level={record.impact} />}
        action={
          <Link
            to="/history"
            className="rounded-sm border border-border-strong px-4 py-2.5 text-sm font-semibold uppercase tracking-wide hover:bg-accent"
          >
            Back to repository
          </Link>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Panel title="Location" bodyClassName="p-0">
            <MapView
              className="h-[380px] rounded-none border-0"
              incidents={[]}
              marker={marker}
              center={marker}
              zoom={6}
              layers={DEFAULT_LAYERS}
            />
          </Panel>

          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Response" dense>
              <p className="text-[13px] leading-relaxed">{record.response}</p>
            </Panel>
            <Panel title="Outcome" dense>
              <p className="text-[13px] leading-relaxed">{record.outcome}</p>
            </Panel>
          </div>
        </div>

        <div className="space-y-4">
          <Panel title="Record" dense>
            <DataRow label="Location" value={formatCoord(record.lat, record.lon)} />
            <DataRow label="Region" value={record.region} />
            <DataRow label="Date" value={record.date} />
            <DataRow label="Oil type" value={record.oilType} />
            <DataRow label="Persistence" value={record.persistence} />
            <DataRow label="Volume" value={`${record.volumeTonnes.toLocaleString()} t`} />
            <DataRow label="Cause" value={record.cause} />
            <DataRow label="Coastal status" value={record.coastalStatus} />
            <DataRow label="Impact" value={<RiskBadge level={record.impact} />} />
            {record.environmentalImpactScore != null ? (
              <DataRow label="Env. impact score" value={`${record.environmentalImpactScore} / 100`} />
            ) : null}
            {record.distanceToCoastKm != null ? (
              <DataRow label="Distance to coast" value={`${record.distanceToCoastKm} km`} />
            ) : null}
            <DataRow label="Source" value={record.source} />
          </Panel>
          <Disclaimer>{DISCLAIMERS.similarity}</Disclaimer>
        </div>
      </div>
    </AppShell>
  );
}
