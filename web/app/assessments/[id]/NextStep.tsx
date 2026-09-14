"use client";

import Link from "next/link";
import { useState } from "react";

import type { Act } from "../../../lib/acts";
import { CONTRACT_ADDRESS } from "../../../lib/config";
import { manifestRoot } from "../../../lib/packet";
import { sentence } from "../../../lib/present";
import { getRecord } from "../../../lib/read";
import { inFlight, writeAndConfirm, type TxProgress } from "../../../lib/tx";
import type { RecordView } from "../../../lib/types";
import { useWallet } from "../../../lib/wallet";
import { TxFlow } from "../../components/TxFlow";

/** The one act that belongs to each state; the rest are not a question yet. */
const STAGE_ACT: Record<string, Act["id"]> = {
  OPEN: "seal",
  SEALED: "adjudicate",
  ADJUDICATED: "appeal",
};

export function NextStep({ record, acts, onChange }: { record: RecordView; acts: Act[]; onChange: () => void }) {
  const { client } = useWallet();
  const [progress, setProgress] = useState<TxProgress | null>(null);
  const busy = progress ? inFlight(progress.stage) : false;
  const act = acts.find((a) => a.id === STAGE_ACT[record.state]);
  const id = record.assessment_id;

  async function seal() {
    try {
      // The contract recomputes this over the items it stores and refuses a
      // seal naming anything else, so it is computed from the record itself.
      const root = await manifestRoot(
        record.items.map((i) => ({
          evidenceId: i.evidence_id,
          fileSha256: i.file_sha256,
          textSha256: i.text_sha256,
          extractorVersion: i.extractor_version,
        })),
      );
      await writeAndConfirm({
        client,
        address: CONTRACT_ADDRESS,
        functionName: "submit_assessment",
        args: [id, root],
        predicate: async () => (await getRecord(id, true))?.state === "SEALED",
        onProgress: setProgress,
        confirmedDetail: "The packet is sealed and finalized.",
      });
      onChange();
    } catch {
      // TxFlow shows what happened.
    }
  }

  async function adjudicate() {
    const before = record.runs_count;
    try {
      await writeAndConfirm({
        client,
        address: CONTRACT_ADDRESS,
        functionName: "adjudicate",
        args: [id],
        // A panel round: priced without simulating it, and given several minutes to land.
        simulate: false,
        predicateTries: 80,
        predicate: async () => ((await getRecord(id, true))?.runs_count ?? 0) > before,
        onProgress: setProgress,
        confirmedDetail: "The verdict is recorded and finalized.",
      });
      onChange();
    } catch {
      // TxFlow shows what happened.
    }
  }

  return (
    <div className="card card-tight">
      <h3 style={{ marginBottom: 10 }}>Next step</h3>
      {!act ? null : act.available ? (
        act.id === "appeal" ? (
          <Link className="btn btn-primary" style={{ width: "100%" }} href={`/assessments/${id}/appeal`}>
            {act.label}
          </Link>
        ) : (
          <button
            className="btn btn-primary"
            style={{ width: "100%" }}
            disabled={busy}
            onClick={act.id === "seal" ? seal : adjudicate}
          >
            {busy ? (act.id === "seal" ? "Sealing…" : "The panel is judging…") : act.label}
          </button>
        )
      ) : (
        <p className="act-blocked">
          <b>{act.label}</b>
          <span>{sentence(act.reason)}</span>
        </p>
      )}
      {act?.id === "seal" && act.available ? (
        <p className="fine" style={{ marginTop: 10 }}>
          Sealing closes intake for good: nothing can be added to this packet afterwards, and new
          evidence then waits for an appeal.
        </p>
      ) : null}
      {act?.id === "adjudicate" && act.available ? (
        <p className="fine" style={{ marginTop: 10 }}>
          Validators read the sealed packet and must agree on every finding. A round usually takes a
          few minutes.
        </p>
      ) : null}
      <TxFlow p={progress} />
      {record.items.length > 0 ? (
        <>
          <div className="divider" />
          <Link className="link small" href={`/assessments/${id}/receipt`}>
            Intake receipt: is my evidence in the judged record? →
          </Link>
        </>
      ) : null}
    </div>
  );
}
