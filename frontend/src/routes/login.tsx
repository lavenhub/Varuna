import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { OilyWordmark } from "@/components/oily/OilyMark";
import { DEMO_CREDENTIALS } from "@/lib/oily/data";
import { oilyStore } from "@/lib/oily/store";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign In — Varuna Spill Response Platform" },
      {
        name: "description",
        content: "Sign in to the Varuna command center to monitor spills and coordinate response.",
      },
      { property: "og:title", content: "Sign In — Varuna" },
      { property: "og:description", content: "Access the Varuna oil-spill command center." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function signIn(useEmail: string, usePassword: string) {
    if (!useEmail.trim() || !usePassword.trim()) {
      setError("Enter both an email address and a password.");
      return;
    }
    oilyStore.signIn({
      email: useEmail,
      fullName: useEmail === DEMO_CREDENTIALS.email ? "Demo Operator" : useEmail.split("@")[0]!,
      organization: "Maritime Response Centre",
      role: "operator",
      roleTitle: "Response Operator",
    });
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <Link to="/">
        <OilyWordmark />
      </Link>
      <div className="mt-6 w-full max-w-md rounded-md border border-border bg-card p-6 shadow-[var(--shadow-panel)]">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Operational access to the Varuna command center.
        </p>

        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            signIn(email, password);
          }}
        >
          <div>
            <label className="label-caps" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-sm border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              placeholder="operator@oily.demo"
            />
          </div>
          <div>
            <label className="label-caps" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-sm border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              placeholder="••••••••"
            />
          </div>
          {error ? <p className="text-xs text-critical">{error}</p> : null}
          {notice ? <p className="text-xs text-safe">{notice}</p> : null}
          <button
            type="submit"
            className="w-full rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-primary-foreground hover:brightness-110"
          >
            Sign In
          </button>
        </form>

        <button
          onClick={() => signIn(DEMO_CREDENTIALS.email, DEMO_CREDENTIALS.password)}
          className="mt-3 w-full rounded-sm border border-border-strong bg-surface px-4 py-2.5 text-sm font-semibold uppercase tracking-wide hover:bg-accent"
        >
          Use Demo Account
        </button>

        <div className="mt-4 flex items-center justify-between text-[13px]">
          <button
            className="text-primary hover:underline"
            onClick={() => setNotice("Password reset instructions would be sent to your email.")}
          >
            Forgot password?
          </button>
          <Link to="/register" className="text-primary hover:underline">
            Create account
          </Link>
        </div>

        <div className="mt-5 rounded-sm border border-border bg-surface p-3 text-[12px] text-muted-foreground">
          <p className="label-caps mb-1">Demonstration account</p>
          <p className="num">{DEMO_CREDENTIALS.email}</p>
          <p className="num">{DEMO_CREDENTIALS.password}</p>
        </div>
      </div>
    </div>
  );
}
