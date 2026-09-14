"use client";

import { explorerTx } from "../../lib/config";
import { STAGE_LABEL, STAGE_TRACK, stageClass, type TxProgress } from "../../lib/tx";
import { CopyText } from "./bits";

/**
 * A write's progress: estimating → wallet → submitted → pending → accepted →
 * finalized, with the transaction hash shown the moment one exists. A
 * terminal report is painted on the stage it belongs to, so a refusal in the
 * fee simulation never looks like a wallet that did not open.
 */
export function TxFlow({ p }: { p: TxProgress | null }) {
  if (!p || p.stage === "idle") return null;
  const terminal = p.stage === "failed" || p.stage === "rejected" || p.stage === "unresolved";
  return (
    <div className="txflow" role="status" aria-live="polite">
      <div className="txsteps">
        {STAGE_TRACK.map((s) => (
          <span key={s} className={stageClass(s, p.stage, p.at)}>
            <i className="knot" aria-hidden />
            {STAGE_LABEL[s]}
          </span>
        ))}
        {terminal ? (
          <span className="txstep fail">
            <i className="knot" aria-hidden />
            {STAGE_LABEL[p.stage]}
          </span>
        ) : null}
      </div>
      <div className="txdetail">
        {p.detail}
        {p.hash ? (
          <span className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            <a href={explorerTx(p.hash)} target="_blank" rel="noreferrer">
              View transaction ↗
            </a>
            <CopyText value={p.hash} short={`${p.hash.slice(0, 10)}…${p.hash.slice(-6)}`} />
          </span>
        ) : null}
      </div>
    </div>
  );
}
