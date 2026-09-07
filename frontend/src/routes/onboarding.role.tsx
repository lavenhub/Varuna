import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Check, ClipboardList, Leaf, Radio, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { OilyWordmark } from "@/components/oily/OilyMark";
import { ROLES } from "@/lib/oily/data";
import { oilyStore } from "@/lib/oily/store";

export const Route = createFileRoute("/onboarding/role")({
  head: () => ({
    meta: [
      { title: "Select Your Role — Varuna Onboarding" },
      {
        name: "description",
        content:
          "Choose how you will use Varuna: response operator, environmental analyst, incident analyst or administrator.",
      },
      { property: "og:title", content: "Select Your Role — Varuna" },
      { property: "og:description", content: "Role-based onboarding for the Varuna platform." },
    ],
  }),
  component: RoleSelection,
});

const ICONS = [Radio, Leaf, ClipboardList, Settings2];

function RoleSelection() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string>("operator");

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-4xl">
        <OilyWordmark />
        <h1 className="mt-8 text-3xl font-semibold tracking-tight">Welcome to Varuna</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Select how you will use the platform.
        </p>

        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          {ROLES.map((role, i) => {
            const Icon = ICONS[i]!;
            const active = selected === role.id;
            return (
              <button
                key={role.id}
                onClick={() => setSelected(role.id)}
                className={cn(
                  "rounded-md border bg-card p-4 text-left transition-colors",
                  active
                    ? "border-primary shadow-[0_0_0_1px_var(--primary)]"
                    : "border-border hover:border-border-strong",
                )}
              >
                <div className="flex items-start justify-between">
                  <Icon className={cn("size-5", active ? "text-primary" : "text-muted-foreground")} />
                  {active ? (
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3" />
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-3 text-sm font-semibold">{role.title}</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {role.description}
                </p>
              </button>
            );
          })}
        </div>

        <button
          onClick={() => {
            const role = ROLES.find((r) => r.id === selected)!;
            oilyStore.signIn({
              email: oilyStore.getSnapshot().session?.email ?? "operator@oily.demo",
              fullName: oilyStore.getSnapshot().session?.fullName ?? "Demo Operator",
              organization:
                oilyStore.getSnapshot().session?.organization ?? "Maritime Response Centre",
              role: role.id,
              roleTitle: role.title,
            });
            navigate({ to: "/dashboard" });
          }}
          className="mt-7 rounded-sm bg-primary px-6 py-3 text-sm font-semibold uppercase tracking-wide text-primary-foreground hover:brightness-110"
        >
          Continue to Varuna
        </button>
      </div>
    </div>
  );
}
