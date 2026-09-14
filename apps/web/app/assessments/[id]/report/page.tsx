"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  attemptLabel,
  claimTypeLabel,
  confidenceLabel,
  corroborationDetail,
  corroborationLabel,
  failureText,
  FLAGS,
  identityLabel,
  nextActionText,
  recordNumber,
  vehicleTitle,
  verdictLabel,
} from "../../../../lib/present";
import { api, EXPLORER, shortHash } from "../../../components/api";
import {
  Chip,
  CopyText,
  IdTag,
  Loading,
  PageError,
  VerdictChip,
} from "../../../components/bits";

interface VerdictPayload {
  recordedContract?: string;
  supersededRecord?: boolean;
  onChainId: string;
  contractAddress: string;
  verdict: {
    standing_run: number;
    total_runs: number;
    rollup: string | null;
    inspection_required: boolean;
    flags: Record<string, boolean>;
    identity_status?: string;
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
  support_classes: string[];
  contradict_classes: string[];
}

interface Detail {
  identityStatus: string;
  vehicle: {
    year: number;
    make: string;
    model: string;
    claims: { claimId: string; declaredValue: string }[];
  };
}

// Screen 9 — the verdict report, rendered from the CONTRACT view.
export default function Report() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<VerdictPayload | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<VerdictPayload>(`/api/assessments/${id}/verdict`)
      .then(setData)
      .catch(setError);
    api<Detail>(`/api/assessments/${id}`)
      .then(setDetail)
      .catch(() => undefined);
  }, [id]);

  if (error) return <PageError error={error} />;
  if (!data) return <Loading />;
  const v = data.verdict;
  const title = detail ? vehicleTitle(detail.vehicle) : "";

  if (!v.rollup)
    return (
      <section className="section" style={{ maxWidth: 720, margin: "0 auto" }}>
        <div className="card" style={{ padding: 30 }}>
          <p className="eyebrow">{[title, recordNumber(data.onChainId)].filter(Boolean).join(" · ")}</p>
          <h2 style={{ marginTop: 6 }}>
            {data.supersededRecord
              ? "Judged on an earlier contract"
              : v.total_runs === 0
                ? "No verdict to show yet"
                : "No verdict stands"}
          </h2>
          {data.supersededRecord ? (
            <>
              <p className="muted" style={{ marginTop: 12 }}>
                This record was judged on an earlier deployment of the
                contract. The contract this app now reads has no history for
                it, so there is nothing to render here.
              </p>
              <p className="muted" style={{ marginTop: 10 }}>
                Nothing was lost: the original verdict stays on the earlier
                contract permanently, and you can read it on the explorer.
                Records opened from now on are judged by the current contract.
              </p>
              <dl className="kv" style={{ marginTop: 16 }}>
                <dt>Judged on</dt>
                <dd>
                  <a
                    className="link tag-mono"
                    href={`${EXPLORER}/address/${data.recordedContract}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortHash(data.recordedContract, 8)} ↗
                  </a>
                </dd>
                <dt>Current contract</dt>
                <dd className="tag-mono">{shortHash(data.contractAddress, 8)}</dd>
              </dl>
            </>
          ) : v.total_runs === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>
              No adjudication has been requested for this record yet. When
              one is, a validator panel judges the sealed packet and the
              verdict appears here.
            </p>
          ) : (
            <p className="muted" style={{ marginTop: 12 }}>
              {v.total_runs === 1
                ? "One attempt is on record, and it did not survive consensus"
                : `${v.total_runs} attempts are on record, and none survived consensus`}
              , so no verdict stands. Every attempt keeps its transaction
              hash, and the record itself is unchanged.
            </p>
          )}
          <Link className="btn btn-ghost" style={{ marginTop: 20 }} href={`/assessments/${id}`}>
            Back to the assessment
          </Link>
        </div>
      </section>
    );

  const declared = new Map(
    (detail?.vehicle.claims ?? []).map((c) => [c.claimId, c.declaredValue]),
  );
  // A flag that IS the headline is not shown again beside it.
  const raised = FLAGS.filter(
    (f) => v.flags?.[f.key] && f.label !== verdictLabel(v.rollup ?? ""),
  );
  // The verdict view does not carry the identity result; the record's
  // copy, read from the contract when the record opened, does.
  const identity = v.identity_status || detail?.identityStatus || "";

  return (
    <section className="section report" style={{ maxWidth: 880, margin: "0 auto" }}>
      <div className="spread" style={{ flexWrap: "wrap", alignItems: "flex-end", marginBottom: 18 }}>
        <div>
          <p className="eyebrow">
            {[title, recordNumber(data.onChainId), `Run ${v.standing_run} of ${v.total_runs}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <h2 style={{ marginTop: 6 }}>Verdict report</h2>
        </div>
        <div className="row no-print" style={{ flexWrap: "wrap" }}>
          <Link className="btn btn-ghost" href={`/assessments/${id}/compare`}>
            Claim-by-claim evidence
          </Link>
          <button className="btn btn-ghost" onClick={() => window.print()}>
            Print or save as PDF
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 30, marginBottom: 18 }}>
        <p className="eyebrow">Overall</p>
        <div className="row" style={{ flexWrap: "wrap", marginTop: 10, gap: 10 }}>
          <VerdictChip verdict={v.rollup} large />
          {v.inspection_required ? (
            <Chip tone="info">Physical inspection recommended</Chip>
          ) : null}
          {raised.map((f) => (
            <Chip key={f.key} tone={f.tone}>
              {f.label}
            </Chip>
          ))}
        </div>
        <p className="fine" style={{ marginTop: 12 }}>
          Derived in code, by fixed precedence over every claim and flag.
        </p>
        {identity ? (
          <p className="small" style={{ marginTop: 14 }}>
            <strong>Independent identity check: {identityLabel(identity)}.</strong>{" "}
            <span className="muted">
              Every validator decoded the VIN at the public federal registry
              itself, before any evidence was judged.
              {v.flags?.vehicle_identity_mismatch
                ? " Because the VIN does not match the listing, no claim here can be marked verified."
                : ""}
            </span>
          </p>
        ) : null}
      </div>

      <div className="spread" style={{ margin: "26px 0 12px", flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 22 }}>Claims</h3>
        <span className="fine">
          Confidence is derived in code from corroboration, findings and
          coverage — never asserted by the panel.
        </span>
      </div>

      <div className="stack">
        {v.claims.map((c) => (
          <div key={c.claim_id} className="card">
            <div className="spread" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
              <div>
                <div className="row" style={{ gap: 8 }}>
                  <IdTag>{c.claim_id}</IdTag>
                  <h3>{claimTypeLabel(c.claim_type)}</h3>
                </div>
                {declared.get(c.claim_id) ? (
                  <p className="small muted" style={{ marginTop: 6 }}>
                    Seller declares: “{declared.get(c.claim_id)}”
                  </p>
                ) : null}
              </div>
              <VerdictChip verdict={c.verdict} />
            </div>

            <dl className="facts" style={{ marginTop: 14 }}>
              <dt>Confidence</dt>
              <dd>{confidenceLabel(c.confidence)}</dd>
              <dt>Backed by</dt>
              <dd>
                <Classes classes={c.support_classes} />
              </dd>
              <dt>Contradicted by</dt>
              <dd>
                <Classes classes={c.contradict_classes} />
              </dd>
              <dt>Next step</dt>
              <dd>{nextActionText(c.next_action)}</dd>
            </dl>

            {v.unresolved_questions[c.claim_id] ? (
              <div className="quote" style={{ marginTop: 14 }}>
                <span className="tag">Panel narrative — not consensus-checked</span>
                <p className="small muted" style={{ marginTop: 6 }}>
                  {v.unresolved_questions[c.claim_id]}
                </p>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        <h3 style={{ marginBottom: 12 }}>Provenance</h3>
        <dl className="kv">
          <dt>Contract</dt>
          <dd>
            <a
              href={`${EXPLORER}/address/${data.contractAddress}`}
              target="_blank"
              rel="noreferrer"
              className="link tag-mono"
            >
              {shortHash(data.contractAddress, 8)} ↗
            </a>
          </dd>
          <dt>On-chain record</dt>
          <dd className="tag-mono">{data.onChainId}</dd>
          <dt>Standing run</dt>
          <dd>
            Run {v.standing_run} of {v.total_runs}
          </dd>
          <dt>Rules version</dt>
          <dd className="tag-mono">{v.ruleset}</dd>
        </dl>
        {data.attempts.length > 0 ? (
          <>
            <div className="divider" />
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Attempt</th>
                    <th>Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {data.attempts.map((a, i) => (
                    <tr key={i}>
                      <td>
                        <Chip
                          tone={
                            a.status === "SUCCESS"
                              ? "ok"
                              : a.status === "REJECTED"
                                ? "dim"
                                : "bad"
                          }
                        >
                          {attemptLabel(a.kind, a.status)}
                        </Chip>
                        {a.errorText ? (
                          <p className="fine" style={{ marginTop: 6, maxWidth: 460 }}>
                            {failureText(a.errorText)}
                          </p>
                        ) : null}
                      </td>
                      <td>
                        {a.txHash ? (
                          <CopyText value={a.txHash} short={shortHash(a.txHash, 8)} />
                        ) : a.status === "SUCCESS" ? (
                          // A recorded verdict IS on chain; only its hash was
                          // never indexed here (records linked from the chain).
                          <span className="fine">Not indexed in this app; the verdict is on chain</span>
                        ) : (
                          <span className="fine">None — it never reached the chain</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
        <p className="fine" style={{ marginTop: 12 }}>
          Every attempt keeps its transaction hash, including refused ones.
          Nothing here is our word alone.
        </p>
      </div>
    </section>
  );
}

function Classes({ classes }: { classes: string[] }) {
  if (classes.length === 0) return <span className="muted">Nothing</span>;
  return (
    <span className="row" style={{ flexWrap: "wrap", gap: 6 }}>
      {classes.map((k) => (
        <span key={k} className="tag" title={corroborationDetail(k)}>
          {corroborationLabel(k)}
        </span>
      ))}
    </span>
  );
}
