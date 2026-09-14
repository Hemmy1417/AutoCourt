"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { awaitingAppeal } from "../../lib/acts";
import {
  evidenceClassLabel,
  formatDate,
  formatDateTime,
  recordNumber,
  vehicleTitle,
} from "../../lib/present";
import { api, EXPLORER, shortAddress } from "../components/api";
import {
  Chip,
  CopyText,
  ErrorNotice,
  IdTag,
  Loading,
  PageError,
  PUBLICITY_STATEMENT,
} from "../components/bits";

interface RecordRef {
  onChainId: string | null;
  vehicle: { year: number; make: string; model: string };
}

interface EvidenceRecord extends RecordRef {
  state: string;
  runs: { status: string; createdAt: string }[];
}

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
    createdAt: string;
    assessment: EvidenceRecord;
  }[];
  shareLinks: {
    id: string;
    assessmentId: string;
    state: string;
    expiresAt: string;
    assessment: RecordRef;
  }[];
}

const recordName = (r: RecordRef) =>
  [vehicleTitle(r.vehicle), recordNumber(r.onChainId)].filter(Boolean).join(" · ");

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

  if (error && !data) return <PageError error={error} />;
  if (!data) return <Loading />;

  return (
    <section className="section" style={{ maxWidth: 760, margin: "0 auto" }}>
      <h2>Account &amp; privacy</h2>

      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Profile</h3>
        <dl className="kv">
          <dt>Name</dt>
          <dd>{data.profile.displayName || "Not set"}</dd>
          <dt>Wallet</dt>
          <dd>
            <CopyText
              value={data.profile.walletAddress}
              short={shortAddress(data.profile.walletAddress)}
            />
          </dd>
        </dl>
        <p className="fine" style={{ marginTop: 12 }}>
          Your wallet address attributes your evidence and disputes on the
          chain record. Identity beyond controlling the wallet is not
          verified, and the verdict floors are designed so that a second
          wallet gains nothing.
        </p>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 10 }}>What becomes permanent</h3>
        <p
          className="small"
          style={{
            background: "var(--signal-soft)",
            borderRadius: 10,
            padding: 14,
          }}
        >
          {PUBLICITY_STATEMENT}
        </p>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Your evidence</h3>
        {data.evidence.length === 0 ? (
          <p className="muted small">You have not uploaded anything yet.</p>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            {data.evidence.map((e) => (
              <div key={e.id} className="spread" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
                <Link href={`/assessments/${e.assessmentId}`} style={{ minWidth: 0 }}>
                  <span className="row" style={{ gap: 8 }}>
                    <IdTag>{e.evidenceId}</IdTag>
                    <span className="small" style={{ fontWeight: 600 }}>
                      {e.declaredLabel || evidenceClassLabel(e.declaredClass)}
                    </span>
                  </span>
                  <span className="fine" style={{ display: "block", marginTop: 2 }}>
                    {recordName(e.assessment)}
                  </span>
                </Link>
                <span className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                  {e.redactionStatus === "REDACTED" ? (
                    <Chip tone="info">Redacted</Chip>
                  ) : null}
                  {e.onChainTxHash ? (
                    <a
                      className="chip chip-bad"
                      href={`${EXPLORER}/tx/${e.onChainTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Public permanently — the chain copy cannot be deleted. Opens the explorer."
                    >
                      <span className="dot" />
                      Public on chain ↗
                    </a>
                  ) : e.assessment.state !== "DRAFT" &&
                    e.consentedAt &&
                    !awaitingAppeal(e, e.assessment.runs) ? (
                    <Chip tone="bad" title="Submitted with the packet, so it is public permanently.">
                      Published with the packet
                    </Chip>
                  ) : e.consentedAt ? (
                    <Chip tone="warn">Consented, not yet submitted</Chip>
                  ) : (
                    <Chip tone="ok">Private to the app</Chip>
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
          <p className="muted small">You have not shared an assessment yet.</p>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            {data.shareLinks.map((l) => (
              <div key={l.id} className="spread" style={{ flexWrap: "wrap" }}>
                <span>
                  <span className="small" style={{ fontWeight: 600, display: "block" }}>
                    {recordName(l.assessment)}
                  </span>
                  <span className="fine">
                    {l.state === "ACTIVE"
                      ? `Expires ${formatDate(l.expiresAt)}`
                      : l.state === "REVOKED"
                        ? "Revoked"
                        : "Expired"}
                  </span>
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
                ) : (
                  <Chip tone="dim">{l.state === "REVOKED" ? "Revoked" : "Expired"}</Chip>
                )}
              </div>
            ))}
          </div>
        )}
        <ErrorNotice error={error} />
        <p className="fine" style={{ marginTop: 12 }}>
          Revoking a link closes the app&apos;s door. It cannot unpublish
          anything already adjudicated; that copy is on the chain.
        </p>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Active sessions</h3>
        <div className="stack" style={{ gap: 10 }}>
          {data.sessions.map((s) => (
            <div key={s.id} className="spread">
              <span className="small">
                Signed in {formatDateTime(s.createdAt)}
              </span>
              {s.id === data.currentSessionId ? (
                <Chip tone="ok">This device</Chip>
              ) : (
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
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
