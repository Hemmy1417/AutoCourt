"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { sameAddress } from "../../../../lib/chain";
import { CONTRACT_ADDRESS, explorerAddress } from "../../../../lib/config";
import { recordNumber } from "../../../../lib/present";
import { getManifest } from "../../../../lib/read";
import type { ManifestView } from "../../../../lib/types";
import { useWallet } from "../../../../lib/wallet";
import { Chip, CopyText, IdTag, Loading, PageError } from "../../../components/bits";
import { useRecord } from "../useRecord";

const short = (h: string, n = 8) => (h.length > n * 2 ? `${h.slice(0, n)}…${h.slice(-6)}` : h);

// The intake receipt: an item that is not in a sealed manifest cannot have
// been judged, and this page shows it from the contract's own manifests.
export default function IntakeReceipt() {
  const { id } = useParams<{ id: string }>();
  const { account } = useWallet();
  const { record, notFound, error } = useRecord(id);
  const [manifests, setManifests] = useState<ManifestView[] | null>(null);

  useEffect(() => {
    if (!record) return;
    Promise.all(Array.from({ length: record.packet_version }, (_, i) => getManifest(id, i + 1)))
      .then((all) => setManifests(all.filter((m): m is ManifestView => m !== null)))
      .catch(() => setManifests([]));
  }, [record, id]);

  if (notFound) return <PageError notFound />;
  if (error && !record) return <PageError error={error} />;
  if (!record || manifests === null) return <Loading />;

  const sealedIn = (evidenceId: string): number | null =>
    manifests.filter((m) => m.entries.some((e) => e[0] === evidenceId)).map((m) => m.version).sort((a, b) => a - b)[0] ?? null;
  const mine = record.items.filter((i) => account && sameAddress(i.uploader_account, account));

  return (
    <section className="section" style={{ maxWidth: 820, margin: "0 auto" }}>
      <p className="eyebrow">{recordNumber(id)}</p>
      <h2 style={{ marginTop: 6 }}>Intake receipt</h2>
      <p className="muted" style={{ marginTop: 8 }}>
        Straight from the contract&apos;s manifests. An item that is not in a sealed packet cannot have
        been judged, and the fingerprints below are the ones your wallet signed.
      </p>

      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Your evidence</h3>
        {!account ? (
          <p className="muted small">Connect the wallet you added evidence with to see your items here.</p>
        ) : mine.length === 0 ? (
          <p className="muted small">This wallet has no items on this record.</p>
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
                {mine.map((i) => {
                  const v = sealedIn(i.evidence_id);
                  return (
                    <tr key={i.evidence_id}>
                      <td>
                        <IdTag>{i.evidence_id}</IdTag>
                      </td>
                      <td>
                        {v !== null ? (
                          <Chip tone="ok">In the sealed packet · version {v}</Chip>
                        ) : i.phase === "APPEAL" ? (
                          <Chip tone="signal">On the record, waiting for an appeal</Chip>
                        ) : (
                          <Chip tone="signal">On the record, not yet sealed</Chip>
                        )}
                      </td>
                      <td>
                        <CopyText value={i.text_sha256} short={short(i.text_sha256)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {manifests.map((m) => (
        <div key={m.version} className="card" style={{ marginTop: 14 }}>
          <div className="spread" style={{ flexWrap: "wrap" }}>
            <h3>Sealed manifest, version {m.version}</h3>
            <span className="row small muted" style={{ gap: 8 }}>
              Root <CopyText value={m.root} short={short(m.root)} />
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
                      <CopyText value={e[1] ?? ""} short={short(e[1] ?? "", 6)} />
                    </td>
                    <td>
                      <CopyText value={e[2] ?? ""} short={short(e[2] ?? "", 6)} />
                    </td>
                    <td className="tag-mono muted">{e[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {manifests.length === 0 ? (
        <p className="notice notice-dim" style={{ marginTop: 14 }}>
          No packet has been sealed on this record yet, so no manifest exists.
        </p>
      ) : null}

      <div className="card card-tight" style={{ marginTop: 14 }}>
        <h3 style={{ marginBottom: 10 }}>Check it yourself</h3>
        <dl className="kv">
          <dt>Contract</dt>
          <dd>
            <a className="link tag-mono" href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">
              {short(CONTRACT_ADDRESS)} ↗
            </a>
          </dd>
          <dt>On-chain record</dt>
          <dd className="tag-mono">{id}</dd>
        </dl>
        <p className="fine" style={{ marginTop: 10 }}>
          Read the manifest with <code>get_manifest</code> for this record and version, and any item
          with <code>get_item_text</code>; the text fingerprint is the SHA-256 of the item&apos;s text.
        </p>
      </div>
    </section>
  );
}
