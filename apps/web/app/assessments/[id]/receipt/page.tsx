"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { recordNumber } from "../../../../lib/present";
import { api, EXPLORER, shortHash } from "../../../components/api";
import {
  Chip,
  CopyText,
  IdTag,
  Loading,
  PageError,
} from "../../../components/bits";

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

  if (error) return <PageError error={error} />;
  if (!data) return <Loading />;

  // The panel judges sealed manifests. Being on chain is not enough: an
  // item entered but not yet sealed has not been judged by anyone.
  const sealedIn = (evidenceId: string): number | null => {
    const hit = Object.entries(data.manifests)
      .filter(([, m]) => m.entries.some((e) => e[0] === evidenceId))
      .map(([v]) => Number(v))
      .sort((a, b) => a - b)[0];
    return hit ?? null;
  };

  return (
    <section className="section" style={{ maxWidth: 820, margin: "0 auto" }}>
      <p className="eyebrow">{recordNumber(data.onChainId)}</p>
      <h2 style={{ marginTop: 6 }}>Intake receipt</h2>
      <p className="muted" style={{ marginTop: 8 }}>
        Straight from the contract&apos;s manifest, not our database. An item
        that is not in a sealed packet cannot have been judged, and the
        fingerprints below prove what you gave us.
      </p>

      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Your evidence</h3>
        {data.myItems.length === 0 ? (
          <p className="muted small">You have no items on this assessment.</p>
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Status</th>
                  <th>Text fingerprint</th>
                </tr>
              </thead>
              <tbody>
                {data.myItems.map((i) => (
                  <tr key={i.evidenceId}>
                    <td>
                      <IdTag>{i.evidenceId}</IdTag>
                    </td>
                    <td>
                      {sealedIn(i.evidenceId) !== null ? (
                        <Chip tone="ok">
                          In the sealed packet · version {sealedIn(i.evidenceId)}
                        </Chip>
                      ) : i.onChain ? (
                        <Chip tone="signal">On chain, not yet sealed</Chip>
                      ) : (
                        <Chip tone="warn">Not on chain yet</Chip>
                      )}
                    </td>
                    <td>
                      <CopyText value={i.textSha256} short={shortHash(i.textSha256, 8)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {Object.entries(data.manifests).map(([version, m]) => (
        <div key={version} className="card" style={{ marginTop: 14 }}>
          <div className="spread" style={{ flexWrap: "wrap" }}>
            <h3>Sealed manifest, version {version}</h3>
            <span className="row small muted" style={{ gap: 8 }}>
              Root <CopyText value={m.root} short={shortHash(m.root, 8)} />
            </span>
          </div>
          <div className="scroll-x" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>File fingerprint</th>
                  <th>Text fingerprint</th>
                  <th>Extractor</th>
                </tr>
              </thead>
              <tbody>
                {m.entries.map((e, i) => (
                  <tr key={i}>
                    <td>
                      <IdTag>{e[0]}</IdTag>
                    </td>
                    <td>
                      <CopyText value={e[1] ?? ""} short={shortHash(e[1] ?? "", 6)} />
                    </td>
                    <td>
                      <CopyText value={e[2] ?? ""} short={shortHash(e[2] ?? "", 6)} />
                    </td>
                    <td className="tag-mono muted">{e[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="card card-tight" style={{ marginTop: 14 }}>
        <h3 style={{ marginBottom: 10 }}>Check it yourself</h3>
        <dl className="kv">
          <dt>Contract</dt>
          <dd>
            <a
              className="link tag-mono"
              href={`${EXPLORER}/address/${data.contractAddress}`}
              target="_blank"
              rel="noreferrer"
            >
              {shortHash(data.contractAddress, 8)} ↗
            </a>
          </dd>
          <dt>On-chain record</dt>
          <dd className="tag-mono">{data.onChainId}</dd>
        </dl>
        <p className="fine" style={{ marginTop: 10 }}>
          Read the manifest on the contract with{" "}
          <code>get_manifest</code> for this record and version, or recompute
          any text fingerprint with <code>scripts/verify-extraction.mjs</code>{" "}
          from the repository.
        </p>
      </div>
    </section>
  );
}
