"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "../../../components/api";
import { ErrorNotice, Spinner, VerdictChip } from "../../../components/bits";

interface Finding {
  claim_id: string;
  evidence_id: string;
  status: "SUPPORTED" | "CONTRADICTED" | "ABSENT";
  severity: string;
  quotes: { evidence_id: string; text: string }[];
}

interface RunPayload {
  onChainId: string;
  run: {
    run: number;
    status: string;
    findings: Record<string, Finding[]>;
    sufficiency: Record<string, string>;
    report: {
      claims: {
        claim_id: string;
        claim_type: string;
        verdict: string;
      }[];
    };
  };
}

interface Detail {
  vehicle: {
    claims: { claimId: string; type: string; declaredValue: string }[];
  };
  runs: { runNumber: number; status: string }[];
}

// Screen 10 — claim-by-claim evidence comparison, quotes and all.
export default function Compare() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<RunPayload | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await api<Detail>(`/api/assessments/${id}`);
        setDetail(d);
        const verdict = await api<{ verdict: { standing_run: number } }>(
          `/api/assessments/${id}/verdict`,
        );
        if (verdict.verdict.standing_run > 0) {
          setData(
            await api<RunPayload>(
              `/api/assessments/${id}/runs/${verdict.verdict.standing_run}`,
            ),
          );
        }
      } catch (e) {
        setError(e);
      }
    })();
  }, [id]);

  if (error) return <ErrorNotice error={error} />;
  if (!detail)
    return (
      <div className="row" style={{ justifyContent: "center", padding: 60 }}>
        <Spinner />
      </div>
    );
  if (!data)
    return (
      <section className="section">
        <div className="empty">No standing run to compare yet.</div>
      </section>
    );

  const declaredBy = new Map(
    detail.vehicle.claims.map((c) => [c.claimId, c.declaredValue]),
  );

  return (
    <section className="section" style={{ maxWidth: 900, margin: "0 auto" }}>
      <h2 style={{ marginBottom: 4 }}>Claim-by-claim evidence</h2>
      <p className="muted small" style={{ marginBottom: 22 }}>
        Run {data.run.run} · every non-absent finding below carries a quote
        that grounds, word for word, in the recorded text — a finding whose
        quotes failed to ground was downgraded before anything read it.
      </p>
      <div className="stack" style={{ gap: 16 }}>
        {data.run.report.claims.map((c) => {
          const findings = data.run.findings[c.claim_id] ?? [];
          const supported = findings.filter((f) => f.status === "SUPPORTED");
          const contradicted = findings.filter(
            (f) => f.status === "CONTRADICTED",
          );
          return (
            <div key={c.claim_id} className="card card-tight">
              <div className="spread" style={{ flexWrap: "wrap" }}>
                <div>
                  <div className="row">
                    <span className="tag">{c.claim_id}</span>
                    <b>{c.claim_type.replaceAll("_", " ")}</b>
                  </div>
                  <p className="small muted" style={{ marginTop: 4 }}>
                    seller declares: “{declaredBy.get(c.claim_id)}”
                  </p>
                </div>
                <VerdictChip verdict={c.verdict} />
              </div>
              <div
                className="grid"
                style={{
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                  marginTop: 14,
                }}
              >
                <FindingColumn
                  title="Supports the claim"
                  tone="ok"
                  findings={supported}
                />
                <FindingColumn
                  title="Contradicts the claim"
                  tone="bad"
                  findings={contradicted}
                />
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                record: {String(data.run.sufficiency[c.claim_id] ?? "").toLowerCase()}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FindingColumn({
  title,
  tone,
  findings,
}: {
  title: string;
  tone: "ok" | "bad";
  findings: Finding[];
}) {
  return (
    <div
      style={{
        background: tone === "ok" ? "var(--ok-soft)" : "var(--bad-soft)",
        borderRadius: 12,
        padding: 12,
      }}
    >
      <p
        className="small"
        style={{
          fontWeight: 800,
          color: tone === "ok" ? "var(--ok)" : "var(--bad)",
        }}
      >
        {title}
      </p>
      {findings.length === 0 ? (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
          Nothing on the record {tone === "ok" ? "supports" : "contradicts"}{" "}
          this claim — an empty column is an answer, not an omission.
        </p>
      ) : (
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          {findings.map((f, i) => (
            <div key={i}>
              <div className="row">
                <span className="tag">{f.evidence_id}</span>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  severity {f.severity.toLowerCase()}
                </span>
              </div>
              {f.quotes.map((q, j) => (
                <p
                  key={j}
                  className="mono"
                  style={{
                    fontSize: 12,
                    marginTop: 5,
                    background: "rgba(255,255,255,0.75)",
                    borderRadius: 8,
                    padding: "7px 9px",
                  }}
                >
                  “{q.text}”
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
