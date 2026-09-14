"use client";

import { useState } from "react";

import type { Act } from "../../../lib/acts";
import { CONTRACT_ADDRESS } from "../../../lib/config";
import { renderedText } from "../../../lib/evidence/anchor";
import { sha256Text } from "../../../lib/evidence/hash";
import { anchorItemJson, nextEvidenceId } from "../../../lib/packet";
import { sentence } from "../../../lib/present";
import { getRecord } from "../../../lib/read";
import { inFlight, writeAndConfirm, type TxProgress } from "../../../lib/tx";
import type { ChainConfig, RecordView } from "../../../lib/types";
import { useWallet } from "../../../lib/wallet";
import { ErrorNotice } from "../../components/bits";
import { TxFlow } from "../../components/TxFlow";

/**
 * The independent-source lane: the only evidence the CONTRACT fetches, and
 * the only path to VERIFIED. Every validator reads the page itself, and it
 * enters the record only if what they read matches the fingerprint committed
 * here.
 */
export function AddSource({
  record,
  config,
  act,
  onChange,
}: {
  record: RecordView;
  config: ChainConfig;
  act: Act;
  onChange: () => void;
}) {
  const { client, address } = useWallet();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<TxProgress | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const busy = reading || (progress ? inFlight(progress.stage) : false);
  const allowlist = config.anchor_allowlist;

  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const allowed = Boolean(host) && allowlist.some((h) => host === h || host.endsWith(`.${h}`));

  async function send() {
    setError(null);
    setOutcome(null);
    setReading(true);
    let expected = "";
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`the source answered HTTP ${res.status}`);
      // Hash what the validators will read, not the raw response: their
      // browser normalizes whitespace before the contract hashes it.
      const rendered = renderedText(await res.text());
      if (!rendered.trim()) throw new Error("that source returned nothing");
      expected = await sha256Text(rendered);
    } catch (e) {
      setError(new Error(`we could not read that source from this browser (${(e as Error).message}), so the validators would not be able to either`));
      setReading(false);
      return;
    }
    setReading(false);

    const evidenceId = nextEvidenceId(record.items);
    try {
      await writeAndConfirm({
        client,
        address: CONTRACT_ADDRESS,
        functionName: "submit_anchor_item",
        args: [
          record.assessment_id,
          anchorItemJson({ evidence_id: evidenceId, declared_label: label.trim().slice(0, 80), url, expected_sha256: expected }),
        ],
        // Every validator fetches the page inside this write.
        simulate: false,
        predicateTries: 40,
        predicate: async () => {
          const r = await getRecord(record.assessment_id, true);
          const item = r?.items.find((i) => i.evidence_id === evidenceId);
          if (item) {
            setOutcome(
              item.status === "EXTRACTED"
                ? `${evidenceId} entered the record: every validator fetched it and matched its fingerprint.`
                : `${evidenceId} is on the record as unavailable: the validators' copy did not match the fingerprint, so it will never be judged.`,
            );
          }
          return Boolean(item);
        },
        onProgress: setProgress,
        confirmedDetail: `${evidenceId} is on the record and finalized.`,
      });
      setUrl("");
      setLabel("");
      onChange();
    } catch {
      // TxFlow shows what happened.
    }
  }

  return (
    <div className="card card-dashed">
      <h3>Add an independent source</h3>
      <p className="muted small" style={{ marginTop: 6 }}>
        Unlike a document you upload, this one is fetched by <strong>every validator itself</strong>,
        and it only enters the record if they all read the same bytes. It is the only evidence neither
        party can author, and the only way a claim can be verified.
      </p>
      {!act.available ? (
        <p className={allowlist.length === 0 ? "notice notice-warn" : "muted small"} style={{ marginTop: 12 }}>
          {sentence(act.reason)}
        </p>
      ) : !address ? (
        <p className="notice notice-dim" style={{ marginTop: 12 }}>
          Connect a wallet from the top of the page to add a source.
        </p>
      ) : (
        <>
          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="anchor-url">Source address</label>
            <input
              id="anchor-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value.trim())}
              placeholder="https://raw.githubusercontent.com/…/registry-extract.txt"
            />
            <span className="hint">
              {url && host && !allowed
                ? `${host} is not an accepted source on this deployment.`
                : `Accepted sources: ${allowlist.join(", ")}`}
            </span>
          </div>
          <div className="field">
            <label htmlFor="anchor-label">What it is</label>
            <input
              id="anchor-label"
              type="text"
              maxLength={80}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="National registry extract"
            />
            <span className="hint">Your label. The panel judges the content itself.</span>
          </div>
          <p className="fine">
            This browser reads it once to commit the fingerprint the validators must match. If what
            they fetch differs, the item is recorded as unavailable and never judged.
          </p>
          <ErrorNotice error={error} />
          <button
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            disabled={busy || !url.startsWith("https://") || !allowed || url.length > 300}
            onClick={() => void send()}
          >
            {reading ? "Reading the source…" : busy ? "The validators are fetching it…" : "Send it to the validators"}
          </button>
        </>
      )}
      {outcome ? (
        <p className="notice notice-info" style={{ marginTop: 12 }}>
          {outcome}
        </p>
      ) : null}
      <TxFlow p={progress} />
    </div>
  );
}
