"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { actsFor, freshAppealItems, freshDisputes } from "../../../../lib/acts";
import { CONTRACT_ADDRESS } from "../../../../lib/config";
import { evidenceClassLabel, plural, sentence, statePhrase } from "../../../../lib/present";
import { getRecord } from "../../../../lib/read";
import { inFlight, writeAndConfirm, type TxProgress } from "../../../../lib/tx";
import { useWallet } from "../../../../lib/wallet";
import { Empty, IdTag, Loading, PageError } from "../../../components/bits";
import { TxFlow } from "../../../components/TxFlow";
import { useRecord } from "../useRecord";

// Screen 11 — appeal: a new run over the recorded bytes plus what is new.
export default function AppealScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { client, account } = useWallet();
  const { record, config, notFound, error } = useRecord(id);
  const [grounds, setGrounds] = useState("");
  const [progress, setProgress] = useState<TxProgress | null>(null);
  const busy = progress ? inFlight(progress.stage) : false;

  if (notFound) return <PageError notFound />;
  if (error && !record) return <PageError error={error} />;
  if (!record || !config) return <Loading />;

  if (record.state !== "ADJUDICATED") {
    return (
      <section className="section" style={{ maxWidth: 680, margin: "0 auto" }}>
        <Empty>An appeal needs a standing verdict, and this record is {statePhrase(record.state)}.</Empty>
      </section>
    );
  }

  const appeal = actsFor(record, config, account).find((a) => a.id === "appeal")!;
  const runsLeft = Math.max(0, config.max_runs_per_assessment - record.runs_count);
  const newItems = freshAppealItems(record);
  const newDisputes = freshDisputes(record);

  async function file() {
    const before = record!.runs_count;
    try {
      await writeAndConfirm({
        client,
        address: CONTRACT_ADDRESS,
        functionName: "readjudicate",
        args: [id, account, grounds.trim()],
        // An appeal is a panel round: priced without simulating it.
        simulate: false,
        predicateTries: 80,
        predicate: async () => ((await getRecord(id, true))?.runs_count ?? 0) > before,
        onProgress: setProgress,
        confirmedDetail: "The appeal's verdict is recorded and finalized.",
      });
      router.push(`/assessments/${id}/report`);
    } catch {
      // TxFlow shows what happened.
    }
  }

  return (
    <section className="section" style={{ maxWidth: 680, margin: "0 auto" }}>
      <h2>Appeal the verdict</h2>
      <p className="muted" style={{ marginTop: 8 }}>
        An appeal re-judges the <em>recorded</em> evidence — exactly what the first panel read,
        straight from the contract&apos;s own storage — plus anything new, clearly marked as arriving
        after the outcome was known. Earlier runs stay on the record.
      </p>
      <p className="fine" style={{ marginTop: 8 }}>
        {runsLeft === 0
          ? `This record already holds the ${config.max_runs_per_assessment} runs the contract allows.`
          : `${plural(runsLeft, "run")} left of the ${config.max_runs_per_assessment} the contract allows.`}
      </p>

      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ marginBottom: 10 }}>What is new since the verdict</h3>
        {newItems.length === 0 && newDisputes.length === 0 ? (
          <p className="muted small">
            Nothing yet.{" "}
            <Link href={`/assessments/${id}`} className="link">
              Add appeal evidence or record a dispute on the record
            </Link>
            ; either one supports an appeal.
          </p>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {newItems.map((i) => (
              <div key={i.evidence_id} className="row small" style={{ gap: 10 }}>
                <IdTag>{i.evidence_id}</IdTag>
                <span>{i.declared_label || evidenceClassLabel(i.declared_class)}</span>
              </div>
            ))}
            {newDisputes.length > 0 ? (
              <p className="small">{plural(newDisputes.length, "new dispute")} on the record.</p>
            ) : null}
          </div>
        )}

        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="grounds">Grounds for the appeal</label>
          <textarea
            id="grounds"
            rows={4}
            maxLength={config.max_grounds_chars}
            value={grounds}
            onChange={(e) => setGrounds(e.target.value)}
            placeholder="An independent inspection found frame damage the history record missed."
          />
          <span className="hint spread">
            <span>On the record, and shown to the panel as advocacy.</span>
            <span>
              {grounds.length.toLocaleString("en-US")} / {config.max_grounds_chars.toLocaleString("en-US")}
            </span>
          </span>
        </div>

        {!appeal.available ? (
          <p className="act-blocked" style={{ marginTop: 12 }}>
            <b>{appeal.label}</b>
            <span>{sentence(appeal.reason)}</span>
          </p>
        ) : (
          <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy || !grounds.trim()} onClick={() => void file()}>
            {busy ? "The panel is judging…" : "File the appeal"}
          </button>
        )}
        <TxFlow p={progress} />
      </div>
    </section>
  );
}
