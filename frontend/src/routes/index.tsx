import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Compass, Leaf, Radar, Siren } from "lucide-react";
import heroImage from "@/assets/hero-satellite.jpg";
import { OilyWordmark } from "@/components/oily/OilyMark";
import { DISCLAIMERS } from "@/lib/oily/data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Varuna — Oil Spill Detection & Emergency Response Platform" },
      {
        name: "description",
        content:
          "Varuna turns oil-spill imagery and environmental telemetry into actionable intelligence — detection, drift forecasting, impact assessment and emergency response planning.",
      },
      { property: "og:title", content: "Varuna — Detect. Predict. Protect." },
      {
        property: "og:description",
        content:
          "Operational oil-spill intelligence: ML detection, drift trajectories, environmental exposure and immediate action plans.",
      },
    ],
  }),
  component: Landing,
});

const CAPABILITIES = [
  {
    icon: Radar,
    title: "Detect",
    text: "Classify satellite or aerial imagery and log a confirmed incident in under a minute.",
  },
  {
    icon: Leaf,
    title: "Understand",
    text: "Quantify exposure to coastline, mangroves, reefs, protected areas and fishing grounds.",
  },
  {
    icon: Compass,
    title: "Predict",
    text: "Forecast drift 72 hours ahead from combined current and windage vectors.",
  },
  {
    icon: Siren,
    title: "Act",
    text: "Generate a ranked immediate action plan with reasoning, resources and staffing estimates.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <OilyWordmark />
          <nav className="flex items-center gap-3">
            <Link
              to="/login"
              className="rounded-sm border border-border px-3.5 py-2 text-[13px] font-medium hover:bg-accent"
            >
              Sign In
            </Link>
            <Link
              to="/register"
              className="rounded-sm bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground hover:brightness-110"
            >
              Create Account
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 lg:grid-cols-[1.05fr_1fr] lg:py-20">
        <div>
          <p className="label-caps">Oil Spill Intelligence &amp; Emergency Response</p>
          <h1 className="mt-3 text-5xl font-semibold tracking-tight lg:text-6xl">Varuna</h1>
          <p className="mt-2 text-2xl font-medium text-primary">Detect. Predict. Protect.</p>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Varuna transforms oil-spill imagery and environmental telemetry into actionable
            intelligence — from initial detection to emergency response.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 rounded-sm bg-primary px-5 py-3 text-sm font-semibold uppercase tracking-wide text-primary-foreground hover:brightness-110"
            >
              Enter Varuna <ArrowRight className="size-4" />
            </Link>
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-sm border border-border-strong bg-card px-5 py-3 text-sm font-semibold uppercase tracking-wide hover:bg-accent"
            >
              Explore Platform
            </Link>
          </div>
          <dl className="mt-10 grid max-w-lg grid-cols-3 divide-x divide-border rounded-md border border-border bg-card">
            {[
              ["4,379", "Spills detected"],
              ["180+", "Historical cases"],
              ["72 h", "Drift horizon"],
            ].map(([value, label]) => (
              <div key={label} className="px-4 py-3">
                <dt className="num text-xl font-semibold">{value}</dt>
                <dd className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {label}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <figure className="overflow-hidden rounded-md border border-border bg-card shadow-[var(--shadow-raised)]">
          <img
            src={heroImage}
            alt="Satellite view of an oil slick spreading across coastal ocean water"
            className="h-72 w-full object-cover lg:h-96"
            loading="eager"
          />
          <figcaption className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
            <span>Sample detection scene — Arabian Sea sector</span>
            <span className="num">21.100° N, 72.910° E</span>
          </figcaption>
        </figure>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-12">
          <h2 className="text-lg font-semibold">See → Understand → Predict → Decide → Act</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One connected intelligence loop per incident, not a set of disconnected dashboards.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CAPABILITIES.map((c) => (
              <article key={c.title} className="rounded-md border border-border bg-card p-4">
                <c.icon className="size-5 text-primary" />
                <h3 className="mt-3 text-sm font-semibold uppercase tracking-wide">{c.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{c.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-5 py-8 text-xs text-muted-foreground">
        <p>{DISCLAIMERS.general}</p>
        <p className="mt-2">© 2026 Varuna — Oil Spill Intelligence &amp; Emergency Response.</p>
      </footer>
    </div>
  );
}
