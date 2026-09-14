"use client";

import { useState } from "react";

import type { Act } from "../../../lib/acts";
import { sameAddress } from "../../../lib/chain";
import { CONTRACT_ADDRESS } from "../../../lib/config";
import { claimTypeLabel, plural, sentence } from "../../../lib/present";
import { getRecord } from "../../../lib/read";
import { inFlight, writeAndConfirm, type TxProgress } from "../../../lib/tx";
import type { RecordView } from "../../../lib/types";
import { useWallet } from "../../../lib/wallet";
import { Chip, IdTag } from "../../components/bits";
import { TxFlow } from "../../components/TxFlow";

/** The seller's claims, who disputes them, and the buyer's way to say so on the record. */
export function ClaimsCard({ record, dispute, onChange }: { record: RecordView; dispute: Act; onChange: () => void }) {
  const { client, account } = useWallet();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<TxProgress | null>(null);
  const busy = progress ? inFlight(progress.stage) : false;

  // A dispute stands until the next verdict; saying it twice adds nothing.
  const standing = new Set(
    record.disputes
      .filter((d) => sameAddress(d.account, account) && d.after_runs >= record.runs_count)
      .flatMap((d) => d.claim_ids),
  );
  const repeated = picked.filter((c) => standing.has(c));

  async function file() {
    const before = record.disputes.length;
    try {
      await writeAndConfirm({
        client,
        address: CONTRACT_ADDRESS,
        functionName: "record_dispute",
        args: [record.assessment_id, account, JSON.stringify([...picked].sort()), note.trim()],
        predicate: async () => {
          const r = await getRecord(record.assessment_id, true);
          return Boolean(r && r.disputes.length > before && r.disputes.some((d, i) => i >= before && sameAddress(d.account, account)));
        },
        onProgress: setProgress,
        confirmedDetail: "The dispute is on the record and finalized.",
      });
      setSelecting(false);
      setPicked([]);
      setNote("");
      onChange();
    } catch {
      // TxFlow already shows what happened.
    }
  }

  return (
    <div className="card card-tight">
      <div className="card-title">
        <h3>Claims</h3>
        {dispute.available && !selecting ? (
          <button
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => {
              setProgress(null);
              setSelecting(true);
            }}
          >
            Dispute…
          </button>
        ) : null}
      </div>
      <div className="stack" style={{ gap: 14 }}>
        {record.claims.map((c) => {
          const disputers = new Set(record.disputes.filter((d) => d.claim_ids.includes(c.claim_id)).map((d) => d.account));
          return (
            <div key={c.claim_id}>
              <label className="row" style={{ gap: 8, cursor: selecting ? "pointer" : "default" }}>
                {selecting ? (
                  <input
                    type="checkbox"
                    checked={picked.includes(c.claim_id)}
                    onChange={(e) =>
                      setPicked((p) => (e.target.checked ? [...p, c.claim_id] : p.filter((x) => x !== c.claim_id)))
                    }
                  />
                ) : null}
                <IdTag>{c.claim_id}</IdTag>
                <b className="small">{claimTypeLabel(c.type)}</b>
              </label>
              <p className="small" style={{ marginTop: 4 }}>
                “{c.declared_value}”
              </p>
              {disputers.size > 0 ? (
                <div style={{ marginTop: 6 }}>
                  <Chip tone="warn">Disputed by {plural(disputers.size, "party", "parties")}</Chip>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {!dispute.available && dispute.reason && account ? (
        <p className="fine" style={{ marginTop: 12 }}>
          {sentence(dispute.reason)}
        </p>
      ) : null}
      {selecting ? (
        <div style={{ marginTop: 14 }}>
          <div className="field">
            <label htmlFor="dispute-note">Why you dispute it (optional, on the record)</label>
            <input
              id="dispute-note"
              type="text"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Odometer looks off against the history"
            />
          </div>
          {repeated.length > 0 ? (
            <p className="notice notice-dim">
              You already dispute {repeated.join(", ")}. A dispute stands until the next verdict.
            </p>
          ) : null}
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button
              className="btn btn-primary"
              disabled={busy || picked.length === 0 || repeated.length > 0}
              onClick={file}
            >
              {busy ? "Recording…" : "Record the dispute"}
            </button>
            <button className="btn btn-quiet" disabled={busy} onClick={() => setSelecting(false)}>
              Cancel
            </button>
          </div>
          <p className="fine" style={{ marginTop: 10 }}>
            A dispute is your recorded assertion, not a fact. It gives your evidence against these
            claims its standing, and the panel is told exactly that.
          </p>
        </div>
      ) : null}
      <TxFlow p={progress} />
    </div>
  );
}
