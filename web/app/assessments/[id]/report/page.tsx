"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { truncAddr } from "../../../../lib/chain";
import { CONTRACT_ADDRESS, explorerAddress } from "../../../../lib/config";
import {
  claimTypeLabel,
  confidenceLabel,
  corroborationDetail,
  corroborationLabel,
  FLAGS,
  identityLabel,
  nextActionText,
  recordNumber,
  runLabel,
  vehicleTitle,
  verdictLabel,
} from "../../../../lib/present";
import { getRun } from "../../../../lib/read";
import type { RunView } from "../../../../lib/types";
import { Chip, IdTag, Loading, PageError, VerdictChip } from "../../../components/bits";
import { useRecord } from "../useRecord";

// Screen 9 — the verdict report, rendered from the contract's own views.
export default function Report() {
  const { id } = useParams<{ id: string }>();
  const { record, verdict, notFound, error } = useRecord(id);
  const [runs, setRuns] = useState<RunView[]>([]);

  useEffect(() => {
    if (!record || record.runs_count === 0) return;
    Promise.all(Array.from({ length: record.runs_count }, (_, i) => getRun(id, i + 1)))
      .then((all) => setRuns(all.filter((r): r is RunView => r !== null)))
      .catch(() => setRuns([]));
  }, [record, id]);

  if (notFound) return <PageError notFound />;
  if (error && !record) return <PageError error={error} />;
  if (!record) return <Loading />;
  const title = vehicleTitle(record);

  if (!verdict?.rollup) {
    return (
      <section className="section" style={{ maxWidth: 720, margin: "0 auto" }}>
        <div className="card" style={{ padding: 30 }}>
          <p className="eyebrow">{`${title} · ${recordNumber(id)}`}</p>
          <h2 style={{ marginTop: 6 }}>No verdict to show yet</h2>
          <p className="muted" style={{ marginTop: 12 }}>
            {record.state === "OPEN"
              ? "This record is still taking evidence. Once the seller seals the packet, any party to the record can ask the validator panel to judge it, and the verdict appears here."
              : "The packet is sealed and waiting for the panel. When a round survives consensus, its verdict appears here."}
          </p>
          <Link className="btn btn-ghost" style={{ marginTop: 20 }} href={`/assessments/${id}`}>
            Back to the record
          </Link>
        </div>
      </section>
    );
  }

  const v = verdict;
  const declared = new Map(record.claims.map((c) => [c.claim_id, c.declared_value]));
  // A flag that IS the headline is not shown again beside it.
  const raised = FLAGS.filter((f) => v.flags?.[f.key] && f.label !== verdictLabel(v.rollup ?? ""));

  return (
    <section className="section report" style={{ maxWidth: 880, margin: "0 auto" }}>
      <div className="spread" style={{ flexWrap: "wrap", alignItems: "flex-end", marginBottom: 18 }}>
        <div>
          <p className="eyebrow">{`${title} · ${recordNumber(id)} · Run ${v.standing_run} of ${v.total_runs}`}</p>
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
          <VerdictChip verdict={v.rollup ?? ""} large />
          {v.inspection_required ? <Chip tone="info">Physical inspection recommended</Chip> : null}
          {raised.map((f) => (
            <Chip key={f.key} tone={f.tone}>
              {f.label}
            </Chip>
          ))}
        </div>
        <p className="fine" style={{ marginTop: 12 }}>
          Derived in code, by fixed precedence over every claim and flag.
        </p>
        <p className="small" style={{ marginTop: 14 }}>
          <strong>Independent identity check: {identityLabel(record.identity_status)}.</strong>{" "}
          <span className="muted">
            Every validator decoded the VIN at the public federal registry itself, before any evidence
            was judged.
            {v.flags?.vehicle_identity_mismatch
              ? " Because the VIN does not match the listing, no claim here can be marked verified."
              : ""}
          </span>
        </p>
      </div>

      <div className="spread" style={{ margin: "26px 0 12px", flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 22 }}>Claims</h3>
        <span className="fine">
          Confidence is derived in code from corroboration, findings and coverage — never asserted by
          the panel.
        </span>
      </div>

      <div className="stack">
        {(v.claims ?? []).map((c) => (
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

            {v.unresolved_questions?.[c.claim_id] ? (
              <div className="quote" style={{ marginTop: 14 }}>
                <span className="tag">Panel narrative — not consensus-checked</span>
                <p className="small muted" style={{ marginTop: 6 }}>
                  {capped(v.unresolved_questions[c.claim_id]!)}
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
            <a href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer" className="link tag-mono">
              {`${CONTRACT_ADDRESS.slice(0, 10)}…${CONTRACT_ADDRESS.slice(-6)}`} ↗
            </a>
          </dd>
          <dt>On-chain record</dt>
          <dd className="tag-mono">{id}</dd>
          <dt>Standing run</dt>
          <dd>
            Run {v.standing_run} of {v.total_runs}
          </dd>
          <dt>Rules version</dt>
          <dd className="tag-mono">{v.ruleset}</dd>
        </dl>
        {runs.length > 0 ? (
          <>
            <div className="divider" />
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Headline</th>
                    <th>Judged packet</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.run}>
                      <td>
                        {r.run} · {runLabel(r.kind)}
                        {r.appellant ? <span className="fine"> by {truncAddr(r.appellant)}</span> : null}
                      </td>
                      <td>
                        <VerdictChip verdict={r.report.rollup} />
                      </td>
                      <td>Version {r.packet_version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
        <p className="fine" style={{ marginTop: 12 }}>
          Every run is written once and never edited; an appeal adds a run beside the earlier ones.
          Nothing here is our word alone: this page reads the contract directly.
        </p>
      </div>
    </section>
  );
}

/** The contract stores at most 400 characters of panel prose per claim. */
const NARRATIVE_CAP = 400;
function capped(text: string): string {
  return text.length >= NARRATIVE_CAP && !/[.!?]$/.test(text) ? `${text.trimEnd()}…` : text;
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
