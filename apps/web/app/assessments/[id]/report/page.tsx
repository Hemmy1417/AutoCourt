"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { api, EXPLORER, shortHash } from "../../../components/api";
import {
  CopyText,
  ErrorNotice,
  Spinner,
  VerdictChip,
} from "../../../components/bits";

interface VerdictPayload {
  onChainId: string;
  contractAddress: string;
  verdict: {
    standing_run: number;
    total_runs: number;
    rollup: string | null;
    inspection_required: boolean;
    flags: Record<string, boolean>;
    claims: ClaimResult[];
    unresolved_questions: Record<string, string>;
    ruleset: string;
  };
  attempts: {
    runNumber: number;
    status: string;
    kind: string;
    txHash: string | null;
    errorText: string;
  }[];
}

interface ClaimResult {
  claim_id: string;
  claim_type: string;
  verdict: string;
  adverse: boolean;
  confidence: string;
  next_action: string;
  supporting: string[];
  contradicting: string[];
  support_classes: string[];
  contradict_classes: string[];
}

const NEXT_ACTION_COPY: Record<string, string> = {
  NONE: "No action needed.",
  OBTAIN_INDEPENDENT_RECORD:
    "Obtain an independent record (registry extract, third-party history) to lift this claim.",
  RAISE_WITH_SELLER: "Raise the contradiction with the seller before going further.",
  REQUEST_DOCUMENTATION: "Request the missing documentation from the seller.",
  BOOK_MECHANICAL_INSPECTION:
    "Book a physical mechanical inspection before purchase.",
};

// Screen 9 — the verdict report, rendered from the CONTRACT view.
export default function Report() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<VerdictPayload | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<VerdictPayload>(`/api/assessments/${id}/verdict`)
      .then(setData)
      .catch(setError);
  }, [id]);

  if (error) return <ErrorNotice error={error} />;
  if (!data)
    return (
      <div className="row" style={{ justifyContent: "center", padding: 60 }}>
        <Spinner />
      </div>
    );
  const v = data.verdict;
  if (!v.rollup)
    return (
      <section className="section">
        <div className="empty">
          No standing verdict yet — {v.total_runs} attempt
          {v.total_runs === 1 ? "" : "s"} on record, none has survived
          consensus. The prior state of the record stands.
        </div>
      </section>
    );

  return (
    <section className="section" style={{ maxWidth: 860, margin: "0 auto" }}>
      <div className="spread" style={{ flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <p className="muted small">
            Assessment {data.onChainId} · run {v.standing_run} of{" "}
            {v.total_runs} · ruleset {v.ruleset}
          </p>
          <h2 style={{ marginTop: 6 }}>Verdict report</h2>
        </div>
        <div className="row">
          <Link className="btn btn-ghost" href={`/assessments/${id}/compare`}>
            Claim-by-claim evidence
          </Link>
          <button className="btn btn-ghost" onClick={() => window.print()}>
            Export / print
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 30, marginBottom: 18 }}>
        <p className="muted small" style={{ marginBottom: 8 }}>
          The headline, derived by fixed precedence over every claim and flag
        </p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <span style={{ fontSize: 26 }}>
            <VerdictChip verdict={v.rollup} />
          </span>
          {v.inspection_required ? (
            <span className="chip chip-info">
              <span className="dot" />
              physical inspection recommended
            </span>
          ) : null}
        </div>
        <div className="row" style={{ marginTop: 14, flexWrap: "wrap" }}>
          {Object.entries(v.flags).map(([flag, set]) =>
            set ? (
              <VerdictChip
                key={flag}
                verdict={
                  flag === "mileage_conflict"
                    ? "MILEAGE_CONFLICT"
                    : flag === "odometer_rollback_indicated"
                      ? "POSSIBLE_ODOMETER_ROLLBACK"
                      : "DIAGNOSTIC_CONCERN_SUPPORTED"
                }
              />
            ) : null,
          )}
        </div>
      </div>

      <div className="stack">
        {v.claims.map((c) => (
          <div key={c.claim_id} className="card card-tight">
            <div className="spread" style={{ flexWrap: "wrap" }}>
              <div className="row">
                <span className="tag">{c.claim_id}</span>
                <b>{c.claim_type.replaceAll("_", " ")}</b>
              </div>
              <VerdictChip verdict={c.verdict} />
            </div>
            <div className="row small muted" style={{ marginTop: 10, flexWrap: "wrap" }}>
              <span>
                confidence <b>{c.confidence}</b> (derived in code from
                corroboration, findings and coverage)
              </span>
              <span>·</span>
              <span>
                support{" "}
                {c.support_classes.join("/").toLowerCase() || "none"} ·
                contradiction{" "}
                {c.contradict_classes.join("/").toLowerCase() || "none"}
              </span>
            </div>
            <p className="small" style={{ marginTop: 8 }}>
              <b>Next:</b> {NEXT_ACTION_COPY[c.next_action] ?? c.next_action}
            </p>
            {v.unresolved_questions[c.claim_id] ? (
              <p
                className="small muted"
                style={{
                  marginTop: 8,
                  borderLeft: "3px solid var(--hairline)",
                  paddingLeft: 10,
                }}
              >
                <span className="tag" style={{ marginRight: 6 }}>
                  panel narrative — not consensus-checked
                </span>
                {v.unresolved_questions[c.claim_id]}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="card card-tight" style={{ marginTop: 18 }}>
        <h3 style={{ marginBottom: 10 }}>Provenance</h3>
        <div className="kv">
          <dt>Contract</dt>
          <dd>
            <a
              href={`${EXPLORER}/address/${data.contractAddress}`}
              target="_blank"
              rel="noreferrer"
              className="mono"
              style={{ fontSize: 12 }}
            >
              {shortHash(data.contractAddress, 12)}
            </a>
          </dd>
          <dt>Assessment</dt>
          <dd className="mono" style={{ fontSize: 12 }}>
            {data.onChainId}
          </dd>
          <dt>Standing run</dt>
          <dd>
            {v.standing_run} of {v.total_runs} total
          </dd>
        </div>
        <div className="divider" />
        <div className="stack" style={{ gap: 6 }}>
          {data.attempts.map((a, i) => (
            <div key={i} className="row small" style={{ flexWrap: "wrap" }}>
              <span
                className={`chip ${
                  a.status === "SUCCESS"
                    ? "chip-ok"
                    : a.status === "REJECTED"
                      ? "chip-dim"
                      : "chip-bad"
                }`}
              >
                <span className="dot" />
                {a.kind === "RE_ADJUDICATION" ? "appeal " : ""}
                {a.status.toLowerCase()}
              </span>
              {a.txHash ? (
                <CopyText value={a.txHash} short={shortHash(a.txHash)} />
              ) : null}
              {a.errorText ? <span className="muted">{a.errorText}</span> : null}
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Every attempt keeps its transaction hash — including the ones
          consensus refused. Nothing here is our word alone.
        </p>
      </div>
    </section>
  );
}
