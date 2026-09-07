import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bell,
  Compass,
  FileText,
  Gauge,
  History,
  Layers,
  LayoutDashboard,
  Leaf,
  LogOut,
  Menu,
  ScanSearch,
  Settings,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { oilyStore, useOily } from "@/lib/oily/store";
import { APP_SUBTITLE } from "@/lib/oily/data";
import { OilyMark } from "./OilyMark";
import { ResponseAssistant } from "./ResponseAssistant";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/detect", label: "Detect Spill", icon: ScanSearch },
  { to: "/impact", label: "Environmental Impact", icon: Leaf },
  { to: "/drift", label: "Drift Simulation", icon: Compass },
  { to: "/what-if", label: "What-If Simulator", icon: SlidersHorizontal },
  { to: "/history", label: "History", icon: History },
  { to: "/response", label: "Emergency Response", icon: AlertTriangle },
  { to: "/digital-twin", label: "Digital Twin", icon: Layers },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({
  children,
  contentClassName,
}: {
  children: ReactNode;
  contentClassName?: string;
}) {
  const { session, notifications } = useOily();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    oilyStore.hydrate();
    // Load incidents from the backend (source of truth); keeps the seed on failure.
    void oilyStore.loadIncidents();
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setBellOpen(false);
  }, [pathname]);

  const user = session ?? {
    fullName: "Demo Operator",
    roleTitle: "Response Operator",
    organization: "Maritime Response Centre",
    email: "operator@oily.demo",
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-navy text-navy-foreground transition-transform lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
          <Link to="/dashboard" className="flex items-center gap-2.5">
            <OilyMark className="size-7" />
            <span>
              <span className="block text-base font-semibold tracking-[0.14em]">VARUNA</span>
              <span className="block text-[10px] uppercase tracking-wider text-navy-muted">
                Spill Intelligence
              </span>
            </span>
          </Link>
          <button
            className="lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV.map((item) => {
            const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "mb-0.5 flex items-center gap-2.5 rounded-sm px-3 py-2 text-[13px] transition-colors",
                  active
                    ? "bg-white/12 font-semibold text-white shadow-[inset_2px_0_0_var(--cyan)]"
                    : "text-navy-muted hover:bg-white/8 hover:text-white",
                )}
              >
                <Icon className={cn("size-4", active && "text-cyan")} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 px-4 py-3 text-[12px]">
          <p className="font-semibold text-white">{user.fullName}</p>
          <p className="text-navy-muted">{user.roleTitle}</p>
          <p className="mt-2 text-[10px] uppercase tracking-wider text-navy-muted">Organization</p>
          <p className="text-white/90">{user.organization}</p>
          <button
            onClick={() => {
              oilyStore.signOut();
              navigate({ to: "/login" });
            }}
            className="mt-3 flex w-full items-center gap-2 rounded-sm border border-white/15 px-2.5 py-1.5 text-[12px] text-navy-muted transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut className="size-3.5" /> Logout
          </button>
        </div>
      </aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-foreground/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-surface/95 px-4 py-2.5 backdrop-blur">
          <button
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">Varuna Command Center</p>
            <p className="truncate text-[11px] text-muted-foreground">{APP_SUBTITLE}</p>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <span className="flex items-center gap-1.5 rounded-sm border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground">
              <Gauge className="size-3.5 text-safe" /> Telemetry link nominal
            </span>
          </div>
          <div className="relative">
            <button
              onClick={() => setBellOpen((o) => !o)}
              className="relative flex size-8 items-center justify-center rounded-sm border border-border bg-card"
              aria-label="Notifications"
            >
              <Bell className="size-4" />
              {notifications.length ? (
                <span className="num absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-critical text-[9px] font-bold text-white">
                  {notifications.length}
                </span>
              ) : null}
            </button>
            {bellOpen ? (
              <div className="absolute right-0 top-10 z-30 w-80 rounded-md border border-border bg-card shadow-[var(--shadow-raised)]">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <span className="label-caps">Notifications</span>
                  <button
                    className="text-[11px] text-primary hover:underline"
                    onClick={() => oilyStore.clearNotifications()}
                  >
                    Clear all
                  </button>
                </div>
                <ul className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                      No active notifications
                    </li>
                  ) : (
                    notifications.map((n) => (
                      <li key={n.id} className="flex gap-2.5 border-b border-border/70 px-3 py-2.5 last:border-0">
                        <span
                          className={cn(
                            "mt-1 size-2 shrink-0 rounded-full",
                            n.level === "critical"
                              ? "bg-critical"
                              : n.level === "warning"
                                ? "bg-warning"
                                : n.level === "safe"
                                  ? "bg-safe"
                                  : "bg-primary",
                          )}
                        />
                        <div>
                          <p className="text-xs leading-relaxed">{n.message}</p>
                          <p className="num mt-0.5 text-[10px] text-muted-foreground">{n.time} UTC</p>
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ) : null}
          </div>
        </header>

        <main className={cn("flex-1 space-y-5 p-4 lg:p-6", contentClassName)}>{children}</main>
      </div>

      <ResponseAssistant />
    </div>
  );
}
