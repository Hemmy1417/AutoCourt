"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { api } from "../components/api";
import { ErrorNotice, Spinner } from "../components/bits";

// Screen 2 — sign-in / sign-up.
function AuthInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "up") {
        await api("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password, displayName }),
        });
      } else {
        await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
      }
      router.push(next);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section" style={{ maxWidth: 440, margin: "0 auto" }}>
      <div className="card" style={{ padding: 30 }}>
        <div
          className="row"
          style={{
            background: "var(--well)",
            borderRadius: "var(--r-chip)",
            padding: 4,
            marginBottom: 22,
          }}
        >
          {(["in", "up"] as const).map((m) => (
            <button
              key={m}
              className="btn"
              style={{
                flex: 1,
                background: mode === m ? "var(--card)" : "transparent",
                boxShadow: mode === m ? "var(--shadow-card)" : "none",
                color: mode === m ? "var(--ink)" : "var(--muted)",
                padding: "8px 0",
              }}
              onClick={() => setMode(m)}
            >
              {m === "in" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>
        <h2 style={{ marginBottom: 18 }}>
          {mode === "in" ? "Welcome back" : "Join AutoCourt"}
        </h2>
        {mode === "up" && (
          <div className="field">
            <label>Display name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Alex Nwosu"
            />
          </div>
        )}
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "up" ? "at least 10 characters" : ""}
            onKeyDown={(e) => e.key === "Enter" && go()}
          />
        </div>
        <ErrorNotice error={error} />
        <button
          className="btn btn-primary"
          style={{ width: "100%", marginTop: 12 }}
          disabled={busy || !email || !password}
          onClick={go}
        >
          {busy ? <Spinner /> : mode === "in" ? "Sign in" : "Create account"}
        </button>
        <p className="muted small" style={{ marginTop: 14 }}>
          Accounts attribute evidence and disputes on the record. Identity
          beyond your account is not verified — the verdict floors are what
          make a second inbox worthless.
        </p>
      </div>
    </section>
  );
}

export default function AuthPage() {
  return (
    <Suspense>
      <AuthInner />
    </Suspense>
  );
}
