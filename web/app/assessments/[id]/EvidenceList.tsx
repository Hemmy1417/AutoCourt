"use client";

import { useEffect, useState } from "react";
import { verifyMessage } from "viem";

import { attestationMessage } from "../../../lib/attest";
import { sameAddress } from "../../../lib/chain";
import { evidenceClassLabel, formatDocDate, formatOdometer, sourceHostName } from "../../../lib/present";
import { getItem } from "../../../lib/read";
import type { ItemRecord, ItemSummary, RecordView } from "../../../lib/types";
import { Chip, Empty, ErrorNotice, IdTag, Spinner } from "../../components/bits";

export function EvidenceList({ record, account }: { record: RecordView; account: string }) {
  if (record.items.length === 0) {
    return (
      <Empty>
        The record is empty. Add the paperwork that backs or contests the claims: invoices, history
        reports, scanner reports. Every document is fingerprinted and signed as it enters.
      </Empty>
    );
  }
  return (
    <>
      {[...record.items].sort((a, b) => a.evidence_id.localeCompare(b.evidence_id)).map((item) => (
        <EvidenceCard key={item.evidence_id} record={record} item={item} account={account} />
      ))}
    </>
  );
}

function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname : "";
  } catch {
    return "";
  }
}

type Attested = "checking" | "signed" | "unsigned" | "mismatch";

/**
 * The uploader's signature, checked here against the hashes on the record.
 * Anyone can run the same check: the signature, both hashes and the account
 * are all public.
 */
function useAttestation(item: ItemSummary): Attested {
  const signature = item.uploader_signature ?? "";
  const checkable = Boolean(signature && item.uploader_account);
  const [state, setState] = useState<Exclude<Attested, "unsigned">>("checking");
  useEffect(() => {
    if (!checkable) return;
    let live = true;
    verifyMessage({
      address: item.uploader_account as `0x${string}`,
      message: attestationMessage({
        evidenceId: item.evidence_id,
        textSha256: item.text_sha256,
        fileSha256: item.file_sha256,
      }),
      signature: signature as `0x${string}`,
    })
      .then((ok) => live && setState(ok ? "signed" : "mismatch"))
      .catch(() => live && setState("mismatch"));
    return () => {
      live = false;
    };
  }, [item, checkable, signature]);
  return checkable ? state : "unsigned";
}

function EvidenceCard({ record, item, account }: { record: RecordView; item: ItemSummary; account: string }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState<ItemRecord | null>(null);
  const [error, setError] = useState<unknown>(null);
  const anchor = item.lane === "ANCHOR";
  const attested = useAttestation(item);
  // An upload names its uploader; an independent source, the wallet that asked for it.
  const party = (anchor ? item.added_by : item.uploader_account) ?? "";
  const who = sameAddress(party, account)
    ? "you"
    : sameAddress(party, record.seller_account)
      ? "the seller"
      : "a buyer";

  useEffect(() => {
    if (!open || full) return;
    getItem(record.assessment_id, item.evidence_id)
      .then(setFull)
      .catch(setError);
  }, [open, full, record.assessment_id, item.evidence_id]);

  return (
    <div className="card card-tight">
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <IdTag>{item.evidence_id}</IdTag>
        <b className="small">{evidenceClassLabel(item.declared_class)}</b>
        {item.declared_label ? <span className="muted small">“{item.declared_label}”</span> : null}
      </div>

      <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        {anchor ? (
          <>
            {party ? <span className="tag">Requested by {who}</span> : null}
            {item.status === "EXTRACTED" ? (
              <Chip tone="ok">Fetched and hash-agreed by every validator</Chip>
            ) : (
              <Chip tone="dim">Validators could not match it; never judged</Chip>
            )}
          </>
        ) : (
          <>
            <span className="tag">Uploaded by {who}</span>
            {attested === "signed" ? (
              <Chip tone="ok" title="The uploader's wallet signed these exact fingerprints">
                Signed by its uploader
              </Chip>
            ) : attested === "mismatch" ? (
              <Chip tone="bad">Signature does not match these bytes</Chip>
            ) : attested === "unsigned" ? (
              <Chip tone="dim">Unsigned</Chip>
            ) : null}
            {item.status === "UNEXTRACTED" ? <Chip tone="dim">Fingerprinted, text not extracted</Chip> : null}
          </>
        )}
        {item.phase === "APPEAL" ? (
          item.judged_version ? (
            <Chip tone="info">Appeal evidence, judged</Chip>
          ) : (
            <Chip tone="signal">New since the verdict</Chip>
          )
        ) : null}
      </div>

      <div className="row actions-row" style={{ marginTop: 8, flexWrap: "wrap", gap: 4 }}>
        <button className="btn btn-quiet" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide text" : "Review text"}
        </button>
      </div>

      {open ? (
        full === null ? (
          error ? (
            <ErrorNotice error={error} />
          ) : (
            <div className="row" style={{ padding: 12 }}>
              <Spinner />
            </div>
          )
        ) : (
          <>
            {anchor && full.url ? (
              <p className="fine" style={{ marginTop: 10 }}>
                Source: {sourceHostName(hostOf(full.url))} ·{" "}
                <a className="link" href={full.url} target="_blank" rel="noreferrer" title={full.url}>
                  open what the validators read ↗
                </a>
              </p>
            ) : null}
            {full.status === "EXTRACTED" && full.text ? (
              <pre className="evidence-text">{full.text}</pre>
            ) : (
              <p className="notice notice-dim" style={{ marginTop: 12 }}>
                {anchor
                  ? "The validators' copy of this source did not match the fingerprint it was entered with, so it holds no text and is never judged."
                  : "This document's text could not be extracted. Its content is unknown to the record, and the panel is told so."}
              </p>
            )}
            {full.observations.length > 0 || full.diagnostic_codes.length > 0 ? (
              <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 6 }}>
                {full.observations.map((o, i) => (
                  <span key={i} className="tag" title={o.source_field || undefined}>
                    {formatDocDate(o.doc_date)}
                    {o.odometer_reading !== undefined ? ` · ${formatOdometer(o.odometer_reading, o.odometer_unit)}` : ""}
                  </span>
                ))}
                {full.diagnostic_codes.map((c) => (
                  <span key={c} className="tag">
                    Trouble code {c}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        )
      ) : null}
    </div>
  );
}
