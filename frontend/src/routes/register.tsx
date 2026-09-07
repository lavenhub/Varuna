import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { OilyWordmark } from "@/components/oily/OilyMark";
import { oilyStore } from "@/lib/oily/store";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Create Account — Varuna Spill Response Platform" },
      {
        name: "description",
        content: "Register an Varuna account to detect spills, assess impact and plan response.",
      },
      { property: "og:title", content: "Create Account — Varuna" },
      {
        property: "og:description",
        content: "Register for the Varuna oil-spill intelligence platform.",
      },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    organization: "",
    password: "",
    confirm: "",
  });
  const [error, setError] = useState<string | null>(null);

  const field = (key: keyof typeof form, label: string, type = "text") => (
    <div>
      <label className="label-caps" htmlFor={key}>
        {label}
      </label>
      <input
        id={key}
        type={type}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="mt-1 w-full rounded-sm border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
      />
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <Link to="/">
        <OilyWordmark />
      </Link>
      <div className="mt-6 w-full max-w-lg rounded-md border border-border bg-card p-6 shadow-[var(--shadow-panel)]">
        <h1 className="text-xl font-semibold">Create account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Register your organization to access the command center.
        </p>
        <form
          className="mt-5 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.fullName || !form.email || !form.password) {
              setError("Full name, email and password are required.");
              return;
            }
            if (form.password !== form.confirm) {
              setError("Passwords do not match.");
              return;
            }
            oilyStore.signIn({
              email: form.email,
              fullName: form.fullName,
              organization: form.organization || "Maritime Response Centre",
              role: "",
              roleTitle: "Role not selected",
            });
            navigate({ to: "/onboarding/role" });
          }}
        >
          <div className="sm:col-span-2">{field("fullName", "Full Name")}</div>
          <div className="sm:col-span-2">{field("email", "Email", "email")}</div>
          <div className="sm:col-span-2">{field("organization", "Organization")}</div>
          {field("password", "Password", "password")}
          {field("confirm", "Confirm Password", "password")}
          {error ? <p className="text-xs text-critical sm:col-span-2">{error}</p> : null}
          <button
            type="submit"
            className="sm:col-span-2 w-full rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-primary-foreground hover:brightness-110"
          >
            Create Account
          </button>
        </form>
        <p className="mt-4 text-[13px] text-muted-foreground">
          Already registered?{" "}
          <Link to="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
