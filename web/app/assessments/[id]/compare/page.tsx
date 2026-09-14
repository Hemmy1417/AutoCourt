"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { claimTypeLabel, recordNumber, severityLabel, sufficiencyText } from "../../../../lib/present";
import { getRun } from "../../../../lib/read";
import type { Finding, RunView } from "../../../../lib/types";
import { Empty, IdTag, Loading, PageError, VerdictChip } from "../../../components/bits";
import { useRecord } from "../useRecord";

// Screen 10 — claim-by-claim evidence comparison, quotes and all.
export default function Compare() {
  const { id } = useParams<{ id: string }>();
  const { record, verdict, notFound, error } = useRecord(id);
  const [run, setRun] = useState<RunView | null>(null);
  const [runError, setRunError] = useState<unknown>(null);
  const standing = verdict?.standing_run ?? 0;

  useEffect(() => {
    if (standing > 0) getRun(id, standing).then(setRun).catch(setRunError);
  }, [id, standing]);

  if (notFound) return <PageError notFound />;
  if ((error && !record) || runError) return <PageError error={error ?? runError} />;
  if (!record) return <Loading />;
  if (standing === 0) {
    return (
      <section className="section" style={{ maxWidth: 680, margin: "0 auto" }}>
        <Empty>
          There is no verdict to compare yet. Once the panel has judged this record, every claim&apos;s
          supporting and contradicting evidence appears here, quoted.
        </Empty>
      </section>
    );
  }
  if (!run) return <Loading />;

  const declared = new Map(record.claims.map((c) => [c.claim_id, c.declared_value]));

  return (
    <section className="section" style={{ maxWidth: 920, margin: "0 auto" }}>
      <p className="eyebrow">{`${recordNumber(id)} · Run ${run.run}`}</p>
      <div className="spread" style={{ flexWrap: "wrap", marginTop: 6 }}>
        <h2>Claim-by-claim evidence</h2>
        <Link className="btn btn-ghost" href={`/assessments/${id}/report`}>
          Back to the report
        </Link>
      </div>
      <p className="muted" style={{ marginTop: 8, marginBottom: 22 }}>
        Every finding below carries a quote that appears word for word in the recorded evidence. A
        finding whose quotes did not match was downgraded before anything read it.
      </p>
      <div className="stack" style={{ gap: 16 }}>
        {run.report.claims.map((c) => {
          const findings = run.findings[c.claim_id] ?? [];
          const sufficiency = run.sufficiency[c.claim_id];
          return (
            <div key={c.claim_id} className="card">
              <div className="spread" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <IdTag>{c.claim_id}</IdTag>
                    <h3>{claimTypeLabel(c.claim_type)}</h3>
                  </div>
                  <p className="small muted" style={{ marginTop: 6 }}>
                    Seller declares: “{declared.get(c.claim_id)}”
                  </p>
                </div>
                <VerdictChip verdict={c.verdict} />
              </div>
              <div className="columns-2" style={{ marginTop: 16 }}>
                <FindingColumn title="Supports the claim" tone="ok" findings={findings.filter((f) => f.status === "SUPPORTED")} />
                <FindingColumn title="Contradicts the claim" tone="bad" findings={findings.filter((f) => f.status === "CONTRADICTED")} />
              </div>
              {sufficiency ? (
                <p className="fine" style={{ marginTop: 12 }}>
                  {sufficiencyText(sufficiency)}.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FindingColumn({ title, tone, findings }: { title: string; tone: "ok" | "bad"; findings: Finding[] }) {
  return (
    <div style={{ background: tone === "ok" ? "var(--ok-soft)" : "var(--bad-soft)", borderRadius: 12, padding: 14 }}>
      <p className="small" style={{ fontWeight: 800, color: tone === "ok" ? "var(--ok)" : "var(--bad)" }}>
        {title}
      </p>
      {findings.length === 0 ? (
        <p className="fine" style={{ marginTop: 6 }}>
          Nothing on the record {tone === "ok" ? "supports" : "contradicts"} this claim. An empty column
          is an answer, not an omission.
        </p>
      ) : (
        <div className="stack" style={{ gap: 10, marginTop: 10 }}>
          {findings.map((f, i) => (
            <div key={i}>
              <div className="row" style={{ gap: 8 }}>
                <IdTag>{f.evidence_id}</IdTag>
                <span className="fine">{severityLabel(f.severity)} severity</span>
              </div>
              {f.quotes.map((q, j) => (
                <blockquote key={j} className="evidence-quote">
                  “{typeof q === "string" ? q : q.text}”
                </blockquote>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
