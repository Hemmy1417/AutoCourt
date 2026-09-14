"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { actsFor, roleOf } from "../../../lib/acts";
import { identityLabel, plural, recordNumber, registryName, vehicleTitle } from "../../../lib/present";
import { useWallet } from "../../../lib/wallet";
import { Journey, Loading, PageError, StateChip } from "../../components/bits";
import { AddEvidence } from "./AddEvidence";
import { AddSource } from "./AddSource";
import { ClaimsCard } from "./ClaimsCard";
import { EvidenceList } from "./EvidenceList";
import { NextStep } from "./NextStep";
import { useRecord } from "./useRecord";

// Screens 6 + 7 + 8 — the record, read straight from the contract.
export default function RecordPage() {
  const { id } = useParams<{ id: string }>();
  const { account } = useWallet();
  const { record, config, verdict, notFound, error, reload } = useRecord(id);

  if (notFound) return <PageError notFound />;
  if (error && !record) return <PageError error={error} />;
  if (!record || !config) return <Loading />;

  const role = roleOf(record, account);
  const acts = actsFor(record, config, account);
  const act = (idOf: string) => acts.find((a) => a.id === idOf)!;
  const runsLeft = config.max_runs_per_assessment - record.runs_count;

  return (
    <section className="section">
      <div className="spread" style={{ marginBottom: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h2>{vehicleTitle(record)}</h2>
          <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
            <span className="tag">
              VIN <span className="tag-mono">{record.vin}</span>
            </span>
            <span className="tag">
              {record.vin_check_digit_ok ? "Check digit consistent" : "Check digit inconsistent — a fact, not a verdict"}
            </span>
            <span className="tag" title={`On-chain record ${record.assessment_id}`}>
              {recordNumber(record.assessment_id)}
            </span>
            <span className="tag">
              {role === "SELLER"
                ? "You are the seller"
                : role === "PARTY"
                  ? "You are a party to this record"
                  : role === "VISITOR"
                    ? "You are viewing a public record"
                    : "Connect a wallet to take part"}
            </span>
          </div>
        </div>
        <StateChip state={record.state} />
      </div>

      <IdentityRow record={record} />

      <div className="card card-tight" style={{ margin: "18px 0 22px" }}>
        <Journey state={record.state} />
      </div>

      <div className="dossier">
        <aside className="dossier-side">
          <ClaimsCard record={record} dispute={act("dispute")} onChange={reload} />
          <NextStep record={record} acts={acts} onChange={reload} />
        </aside>

        <div className="stack" style={{ gap: 18 }}>
          {record.state === "SEALED" ? (
            <div className="card">
              <h3>Sealed and ready for the panel</h3>
              <p className="muted small" style={{ marginTop: 8 }}>
                The packet is sealed under its manifest root, so nothing can be added or changed.
                Anyone can now ask the validator panel to judge it.
              </p>
            </div>
          ) : null}
          {record.state === "ADJUDICATED" && verdict?.rollup ? (
            <div className="card">
              <div className="spread" style={{ flexWrap: "wrap" }}>
                <h3>The verdict stands</h3>
                <Link className="btn btn-primary" href={`/assessments/${record.assessment_id}/report`}>
                  Open the report
                </Link>
              </div>
              <p className="muted small" style={{ marginTop: 8 }}>
                {runsLeft <= 0
                  ? `This is run ${verdict.standing_run} of ${config.max_runs_per_assessment}, the most the contract allows, so this verdict is final. Earlier runs stay on the record, unchanged.`
                  : `This is run ${verdict.standing_run} of up to ${config.max_runs_per_assessment}. New evidence or a new dispute opens an appeal; earlier runs stay on the record, unchanged.`}
              </p>
            </div>
          ) : null}

          <div className="spread" style={{ marginTop: 4 }}>
            <h3 style={{ fontSize: 22 }}>The record</h3>
            <span className="muted small">{plural(record.items.length, "item")}</span>
          </div>
          <EvidenceList record={record} account={account} />
          {record.state === "OPEN" || (record.state === "ADJUDICATED" && runsLeft > 0) ? (
            <AddEvidence record={record} config={config} act={act("evidence")} onChange={reload} />
          ) : null}
          {record.state === "OPEN" ? (
            <AddSource record={record} config={config} act={act("source")} onChange={reload} />
          ) : null}
        </div>
      </div>
    </section>
  );
}

/**
 * What the public VIN registry said: the one fact on the record that no
 * party supplied. Absence of confirmation is shown as absence, never as an
 * accusation.
 */
function IdentityRow({ record }: { record: { identity_status: string; registry_fields: Record<string, string>; year: number; make: string; model: string } }) {
  const status = record.identity_status;
  if (!status) return null;
  const reg = record.registry_fields ?? {};
  const decoded = [reg.ModelYear, registryName(reg.Make), registryName(reg.Model)].filter(Boolean).join(" ");
  const body = reg.BodyClass ? ` (${registryName(reg.BodyClass)})` : "";
  const text: Record<string, string> = {
    CONFIRMED: decoded
      ? `The VIN decodes to a ${decoded}${body}, consistent with this listing.`
      : "The VIN decodes consistently with this listing.",
    MISMATCH: `The VIN decodes to ${decoded ? `a ${decoded}${body}` : "a different vehicle"}, not a ${vehicleTitle(record)}. Every claim is capped until this is reconciled.`,
    UNDECODABLE: "The registry could not decode this VIN. That is no confirmation either way, and not evidence against anyone.",
    SOURCE_UNAVAILABLE:
      "The registry could not be reached when this record opened. That is no confirmation either way, and not evidence against anyone.",
  };
  const tone = status === "MISMATCH" ? "notice notice-warn" : status === "CONFIRMED" ? "notice notice-ok" : "notice notice-dim";
  return (
    <div className={tone} style={{ maxWidth: 720 }}>
      <strong>Independent identity check: {identityLabel(status)}.</strong> {text[status] ?? ""}
      <div className="fine" style={{ marginTop: 6, color: "inherit", opacity: 0.8 }}>
        Read from the public federal VIN registry by every validator itself, before this record
        existed. No party supplied it.
      </div>
    </div>
  );
}
