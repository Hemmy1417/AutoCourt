"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { api, EXPLORER, shortHash } from "../../../components/api";
import { CopyText, ErrorNotice, Spinner } from "../../../components/bits";

interface Receipt {
  onChainId: string;
  contractAddress: string;
  packetVersion: number;
  manifests: Record<string, { root: string; entries: string[][] }>;
  myItems: {
    evidenceId: string;
    fileSha256: string;
    textSha256: string;
    onChain: boolean;
    judgedVersion: number | null;
    status: string;
  }[];
}

// The intake receipt: omission is the operator's cheapest attack, and
// this page is the detection — YOUR items against the CONTRACT manifest.
export default function IntakeReceipt() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Receipt | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<Receipt>(`/api/assessments/${id}/receipt`).then(setData).catch(setError);
  }, [id]);

  if (error) return <ErrorNotice error={error} />;
  if (!data)
    return (
      <div className="row" style={{ justifyContent: "center", padding: 60 }}>
        <Spinner />
      </div>
    );

  return (
    <section className="section" style={{ maxWidth: 760, margin: "0 auto" }}>
      <h2>Intake receipt</h2>
      <p className="muted" style={{ marginTop: 6 }}>
        Straight from the contract&apos;s manifest — not our database. If an
        item of yours says “not in the judged record”, the record cannot
        have judged it, and you have the hashes to prove what you gave us.
      </p>

      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Your evidence</h3>
        <div className="stack" style={{ gap: 10 }}>
          {data.myItems.length === 0 ? (
            <p className="muted small">You have no items on this assessment.</p>
          ) : (
            data.myItems.map((i) => (
              <div key={i.evidenceId} className="spread" style={{ flexWrap: "wrap" }}>
                <div className="row">
                  <span className="tag">{i.evidenceId}</span>
                  {i.onChain ? (
                    <span className="chip chip-ok">
                      <span className="dot" />
                      in the judged record
                      {i.judgedVersion ? ` (packet v${i.judgedVersion})` : ""}
                    </span>
                  ) : (
                    <span className="chip chip-warn">
                      <span className="dot" />
                      not in any run yet
                    </span>
                  )}
                </div>
                <CopyText
                  value={i.textSha256}
                  short={`text ${shortHash(i.textSha256, 8)}`}
                />
              </div>
            ))
          )}
        </div>
      </div>

      {Object.entries(data.manifests).map(([version, m]) => (
        <div key={version} className="card card-tight" style={{ marginTop: 14 }}>
          <div className="spread">
            <h3>Manifest v{version}</h3>
            <CopyText value={m.root} short={`root ${shortHash(m.root, 8)}`} />
          </div>
          <div className="stack" style={{ gap: 5, marginTop: 10 }}>
            {m.entries.map((e, i) => (
              <div key={i} className="mono muted" style={{ fontSize: 11.5 }}>
                {e[0]} · file {shortHash(e[1] ?? "", 8)} · text{" "}
                {shortHash(e[2] ?? "", 8)} · {e[3]}
              </div>
            ))}
          </div>
        </div>
      ))}

      <p className="muted small" style={{ marginTop: 14 }}>
        Verify independently:{" "}
        <a
          className="mono"
          style={{ fontSize: 12 }}
          href={`${EXPLORER}/address/${data.contractAddress}`}
          target="_blank"
          rel="noreferrer"
        >
          {shortHash(data.contractAddress, 10)}
        </a>{" "}
        · <code>get_manifest(&quot;{data.onChainId}&quot;, v)</code> — or
        recompute any text hash with{" "}
        <code>scripts/verify-extraction.mjs</code> from the repo.
      </p>
    </section>
  );
}
