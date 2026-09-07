import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/oily/AppShell";
import { Disclaimer, PageHeader, Panel } from "@/components/oily/primitives";
import { oilyStore, useOily } from "@/lib/oily/store";
import { ROLES, DISCLAIMERS } from "@/lib/oily/data";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Varuna Spill Intelligence" },
      {
        name: "description",
        content: "Manage your Varuna profile, role, notification preferences and local data.",
      },
      { property: "og:title", content: "Settings — Varuna" },
      { property: "og:description", content: "Profile, role and data management for Varuna." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { session } = useOily();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [form, setForm] = useState({
    fullName: session?.fullName ?? "Demo Operator",
    email: session?.email ?? "operator@oily.demo",
    organization: session?.organization ?? "Maritime Response Centre",
    role: session?.role ?? "operator",
  });
  const [prefs, setPrefs] = useState({
    critical: true,
    warning: true,
    info: false,
    email: false,
  });

  function save() {
    const role = ROLES.find((r) => r.id === form.role);
    oilyStore.updateSession({
      fullName: form.fullName,
      email: form.email,
      organization: form.organization,
      role: form.role,
      roleTitle: role?.title ?? "Response Operator",
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  }

  const fields: { key: "fullName" | "email" | "organization"; label: string; type?: string }[] = [
    { key: "fullName", label: "Full Name" },
    { key: "email", label: "Email", type: "email" },
    { key: "organization", label: "Organization" },
  ];

  return (
    <AppShell>
      <PageHeader title="Settings" subtitle="Manage your profile, role and local application data." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Profile">
          <div className="grid gap-3">
            {fields.map((f) => (
              <div key={f.key}>
                <label className="label-caps" htmlFor={f.key}>
                  {f.label}
                </label>
                <input
                  id={f.key}
                  type={f.type ?? "text"}
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className="mt-1 w-full rounded-sm border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
            ))}
          </div>
          <button
            onClick={save}
            className="mt-4 inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-primary-foreground hover:brightness-110"
          >
            {saved ? <Check className="size-4" /> : null}
            {saved ? "Saved" : "Save Profile"}
          </button>
        </Panel>

        <Panel title="Role">
          <div className="grid gap-2.5">
            {ROLES.map((role) => {
              const active = form.role === role.id;
              return (
                <button
                  key={role.id}
                  onClick={() => setForm({ ...form, role: role.id })}
                  className={cn(
                    "rounded-md border bg-card p-3 text-left transition-colors",
                    active ? "border-primary shadow-[0_0_0_1px_var(--primary)]" : "border-border hover:border-border-strong",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">{role.title}</h3>
                    {active ? (
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3" />
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{role.description}</p>
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel title="Notification Preferences">
          <div className="space-y-1">
            {(
              [
                ["critical", "Critical alerts", "Coastline / MPA exposure and confirmed high-risk spills"],
                ["warning", "Warning alerts", "Trajectory updates and habitat exposure notices"],
                ["info", "Informational", "Telemetry refreshes and routine status changes"],
                ["email", "Email digest", "Daily summary of active incidents to your inbox"],
              ] as const
            ).map(([key, label, desc]) => (
              <label
                key={key}
                className="flex cursor-pointer items-start justify-between gap-3 border-b border-border/70 py-2.5 last:border-0"
              >
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{desc}</span>
                </span>
                <input
                  type="checkbox"
                  checked={prefs[key]}
                  onChange={(e) => setPrefs({ ...prefs, [key]: e.target.checked })}
                  className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                />
              </label>
            ))}
          </div>
        </Panel>

        <Panel title="Data Management">
          <p className="text-sm text-muted-foreground">
            Varuna stores incidents, chats and preferences locally in this browser. Resetting restores the
            seed dataset and clears any incidents you have logged.
          </p>
          {confirmReset ? (
            <div className="mt-4 rounded-md border border-critical/30 bg-critical-soft p-3">
              <p className="text-sm font-semibold text-critical">Reset all local data?</p>
              <p className="mt-1 text-xs text-muted-foreground">This cannot be undone.</p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => {
                    oilyStore.reset();
                    setConfirmReset(false);
                    navigate({ to: "/dashboard" });
                  }}
                  className="rounded-sm bg-critical px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white hover:brightness-110"
                >
                  Yes, reset
                </button>
                <button
                  onClick={() => setConfirmReset(false)}
                  className="rounded-sm border border-border-strong px-4 py-2 text-sm font-semibold uppercase tracking-wide hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              className="mt-4 inline-flex items-center gap-2 rounded-sm border border-critical/40 bg-critical-soft px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-critical hover:brightness-105"
            >
              <Trash2 className="size-4" /> Reset Local Data
            </button>
          )}
        </Panel>
      </div>

      <Disclaimer>{DISCLAIMERS.general}</Disclaimer>
    </AppShell>
  );
}
