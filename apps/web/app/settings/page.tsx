"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api, EXPLORER, shortHash } from "../components/api";
import {
  ErrorNotice,
  PUBLICITY_STATEMENT,
  Spinner,
} from "../components/bits";

interface Settings {
  profile: { id: string; walletAddress: string; displayName: string };
  currentSessionId: string;
  sessions: { id: string; createdAt: string; expiresAt: string }[];
  evidence: {
    id: string;
    assessmentId: string;
    evidenceId: string;
    declaredClass: string;
    declaredLabel: string;
    status: string;
    redactionStatus: string;
    consentedAt: string | null;
    onChainTxHash: string | null;
  }[];
  shareLinks: {
    id: string;
    assessmentId: string;
    state: string;
    expiresAt: string;
  }[];
}

// Screen 13 — account and privacy settings.
export default function SettingsPage() {
  const [data, setData] = useState<Settings | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    api<Settings>("/api/settings").then(setData).catch(setError);

  useEffect(() => {
    load();
  }, []);

  if (error && !data) return <ErrorNotice error={error} />;
  if (!data)
    return (
      <div className="row" style={{ justifyContent: "center", padding: 60 }}>
        <Spinner />
      </div>
    );

  return (
    <section className="section" style={{ maxWidth: 760, margin: "0 auto" }}>
      <h2>Account &amp; privacy</h2>

      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ marginBottom: 10 }}>Profile</h3>
        <div className="kv">
          <dt>Name</dt>
          <dd>{data.profile.displayName || "—"}</dd>
          <dt>Wallet</dt>
          <dd className="mono" style={{ fontSize: 12 }}>
            {data.profile.walletAddress}
          </dd>
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
          Your wallet address is what attributes evidence and disputes on
          the chain record. Identity beyond controlling the wallet is not
          verified — and the verdict floors are designed so that a second
          wallet buys nothing.
        </p>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 6 }}>What becomes permanent</h3>
        <p
          className="small"
          style={{
            background: "var(--signal-soft)",
            borderRadius: 10,
            padding: 12,
          }}
        >
          {PUBLICITY_STATEMENT}
        </p>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Your evidence, item by item</h3>
        {data.evidence.length === 0 ? (
          <p className="muted small">Nothing uploaded yet.</p>
        ) : (
          <div className="stack" style={{ gap: 9 }}>
            {data.evidence.map((e) => (
              <div key={e.id} className="spread" style={{ flexWrap: "wrap" }}>
                <Link
                  href={`/assessments/${e.assessmentId}`}
                  className="row"
                  style={{ flexWrap: "wrap" }}
                >
                  <span className="tag">{e.evidenceId}</span>
                  <span className="small">
                    {e.declaredLabel || e.declaredClass.replaceAll("_", " ")}
                  </span>
                </Link>
                <span className="row" style={{ flexWrap: "wrap" }}>
                  {e.redactionStatus === "REDACTED" ? (
                    <span className="chip chip-info">
                      <span className="dot" />
                      redacted
                    </span>
                  ) : null}
                  {e.onChainTxHash ? (
                    <a
                      className="chip chip-bad"
                      href={`${EXPLORER}/tx/${e.onChainTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                      title="public, permanently — the chain copy cannot be deleted"
                    >
                      <span className="dot" />
                      public on-chain, permanent
                    </a>
                  ) : e.consentedAt ? (
                    <span className="chip chip-warn">
                      <span className="dot" />
                      consented, awaiting submission
                    </span>
                  ) : (
                    <span className="chip chip-ok">
                      <span className="dot" />
                      private to this app
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Share links you issued</h3>
        {data.shareLinks.length === 0 ? (
          <p className="muted small">None.</p>
        ) : (
          <div className="stack" style={{ gap: 9 }}>
            {data.shareLinks.map((l) => (
              <div key={l.id} className="spread" style={{ flexWrap: "wrap" }}>
                <span className="small">
                  link {shortHash(l.id, 6)} ·{" "}
                  {l.state === "ACTIVE"
                    ? `expires ${new Date(l.expiresAt).toLocaleDateString()}`
                    : l.state.toLowerCase()}
                </span>
                {l.state === "ACTIVE" ? (
                  <button
                    className="btn btn-danger"
                    disabled={busy === l.id}
                    onClick={async () => {
                      setBusy(l.id);
                      try {
                        await api(`/api/assessments/${l.assessmentId}/share`, {
                          method: "DELETE",
                          body: JSON.stringify({ linkId: l.id }),
                        });
                        await load();
                      } catch (e) {
                        setError(e);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    Revoke
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Revoking a link closes the app&apos;s door. It cannot unpublish
          anything already adjudicated — that copy is on the chain.
        </p>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Active sessions</h3>
        <div className="stack" style={{ gap: 9 }}>
          {data.sessions.map((s) => (
            <div key={s.id} className="spread">
              <span className="small">
                {new Date(s.createdAt).toLocaleString()}{" "}
                {s.id === data.currentSessionId ? (
                  <span className="tag">this device</span>
                ) : null}
              </span>
              {s.id !== data.currentSessionId ? (
                <button
                  className="btn btn-quiet"
                  disabled={busy === s.id}
                  onClick={async () => {
                    setBusy(s.id);
                    try {
                      await api("/api/settings/sessions", {
                        method: "DELETE",
                        body: JSON.stringify({ sessionId: s.id }),
                      });
                      await load();
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Sign out
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
