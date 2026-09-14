"use client";

import { useMemo, useState } from "react";

import type { Act } from "../../../lib/acts";
import { attestationMessage } from "../../../lib/attest";
import { sameAddress } from "../../../lib/chain";
import { CONTRACT_ADDRESS } from "../../../lib/config";
import { sha256Bytes, sha256Text } from "../../../lib/evidence/hash";
import { extractEvidence } from "../../../lib/evidence/extract";
import { EXTRACTOR_VERSION, normalizeText, PER_ITEM_TEXT_CAP } from "../../../lib/evidence/normalize";
import { applyRedactions } from "../../../lib/evidence/redact";
import { nextEvidenceId, uploadedItemJson, type ObservationRow } from "../../../lib/packet";
import { EVIDENCE_CLASSES, formatBytes, sentence } from "../../../lib/present";
import { getRecord } from "../../../lib/read";
import { inFlight, writeAndConfirm, type TxProgress } from "../../../lib/tx";
import type { ChainConfig, RecordView } from "../../../lib/types";
import { extractDtcs, parseDtc } from "../../../lib/validation/obd";
import { useWallet } from "../../../lib/wallet";
import { ErrorNotice, PUBLICITY_STATEMENT } from "../../components/bits";
import { TxFlow } from "../../components/TxFlow";

/** An upload can be labelled anything except the one lane only validators fill. */
const UPLOAD_CLASSES = EVIDENCE_CLASSES.filter((c) => c.value !== "EXTERNAL_SOURCE_RESULT");

const MAX_FILE_BYTES = 15 * 1024 * 1024;

interface Prepared {
  name: string;
  size: number;
  fileSha256: string;
  status: "EXTRACTED" | "UNEXTRACTED";
  /** Normalized, before redaction. */
  original: string;
}

const EMPTY_ROW = { docDate: "", odometerReading: "", odometerUnit: "MILES", diagnosticCode: "", sourceField: "" };
type Row = typeof EMPTY_ROW;

export function AddEvidence({
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
  const { client, account, address, signMessage } = useWallet();
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [reading, setReading] = useState(false);
  const [declaredClass, setDeclaredClass] = useState("SERVICE_INVOICE");
  const [label, setLabel] = useState("");
  const [captureDate, setCaptureDate] = useState("");
  const [spans, setSpans] = useState<{ start: number; end: number }[]>([]);
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [acked, setAcked] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [progress, setProgress] = useState<TxProgress | null>(null);
  const [error, setError] = useState<unknown>(null);
  const busy = progress ? inFlight(progress.stage) : false;
  const appeal = record.state === "ADJUDICATED";

  const judged = useMemo(
    () => (prepared?.status === "EXTRACTED" ? normalizeText(applyRedactions(prepared.original, spans)) : ""),
    [prepared, spans],
  );
  const suggestedCodes = useMemo(
    () => extractDtcs(judged).map((d) => d.code).filter((c) => !rows.some((r) => r.diagnosticCode === c)),
    [judged, rows],
  );

  if (!act.available) {
    return (
      <div className="card card-dashed">
        <h3 style={{ marginBottom: 6 }}>{act.label}</h3>
        <p className="muted small">{sentence(act.reason)}</p>
      </div>
    );
  }

  function reset() {
    setPrepared(null);
    setInputKey((k) => k + 1);
    setLabel("");
    setCaptureDate("");
    setSpans([]);
    setSel(null);
    setRows([]);
    setAcked(false);
    setDeclined(false);
  }

  async function choose(file: File | null) {
    setError(null);
    setPrepared(null);
    setSpans([]);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError(new Error(`files can be at most ${formatBytes(MAX_FILE_BYTES)}`));
      return;
    }
    setReading(true);
    try {
      // The file never leaves this browser: it is read, fingerprinted and
      // extracted here, and only the fingerprint and the text you approve go on chain.
      const bytes = new Uint8Array(await file.arrayBuffer());
      const [fileSha256, extraction] = await Promise.all([sha256Bytes(bytes), extractEvidence(bytes)]);
      setPrepared({
        name: file.name,
        size: file.size,
        fileSha256,
        status: extraction.status === "EXTRACTED" ? "EXTRACTED" : "UNEXTRACTED",
        original: extraction.normalizedText,
      });
    } catch (e) {
      setError(e);
    } finally {
      setReading(false);
    }
  }

  function payloadRows(): { observations: ObservationRow[]; codes: string[] } {
    const observations: ObservationRow[] = [];
    const codes: string[] = [];
    for (const r of rows) {
      if (r.odometerReading.trim()) {
        observations.push({
          doc_date: r.docDate,
          odometer_reading: Math.round(Number(r.odometerReading)),
          odometer_unit: r.odometerUnit === "KM" ? "KM" : "MILES",
          source_field: r.sourceField.trim().slice(0, 60),
        });
      }
      const dtc = parseDtc(r.diagnosticCode);
      if (dtc && !codes.includes(dtc.code)) codes.push(dtc.code);
    }
    return { observations, codes };
  }

  const rowProblem = rows.some((r) => !r.docDate)
    ? "every reading needs the date on the document"
    : rows.some((r) => r.odometerReading.trim() && !(Number(r.odometerReading) >= 0))
      ? "an odometer reading must be a whole number"
      : rows.some((r) => r.diagnosticCode.trim() && !parseDtc(r.diagnosticCode))
        ? "a trouble code looks like P0301: a letter P, B, C or U, then four characters"
        : rows.some((r) => !r.odometerReading.trim() && !r.diagnosticCode.trim())
          ? "each reading needs an odometer figure or a trouble code"
          : "";

  async function publish(sign: boolean) {
    if (!prepared) return;
    setError(null);
    setDeclined(false);
    const evidenceId = nextEvidenceId(record.items);
    const textSha256 = await sha256Text(judged);
    let signature = "";
    if (sign) {
      try {
        signature = await signMessage(
          attestationMessage({ evidenceId, textSha256, fileSha256: prepared.fileSha256 }),
        );
      } catch {
        setDeclined(true);
        return;
      }
    }
    const { observations, codes } = payloadRows();
    try {
      await writeAndConfirm({
        client,
        address: CONTRACT_ADDRESS,
        functionName: appeal ? "submit_appeal_evidence" : "submit_evidence_text",
        args: [
          record.assessment_id,
          uploadedItemJson({
            evidence_id: evidenceId,
            declared_class: declaredClass,
            declared_label: label.trim().slice(0, 80),
            uploader_account: account,
            uploader_role: sameAddress(account, record.seller_account) ? "SELLER" : "BUYER",
            file_sha256: prepared.fileSha256,
            text_sha256: textSha256,
            extractor_version: EXTRACTOR_VERSION,
            status: prepared.status,
            text: judged,
            uploader_signature: signature,
            observations,
            diagnostic_codes: codes,
            capture_date: captureDate,
          }),
        ],
        predicate: async () =>
          Boolean((await getRecord(record.assessment_id, true))?.items.some((i) => i.evidence_id === evidenceId)),
        onProgress: setProgress,
        confirmedDetail: `${evidenceId} is on the record and finalized.`,
      });
      reset();
      onChange();
    } catch {
      // TxFlow shows what happened.
    }
  }

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="card card-dashed">
      <h3 style={{ marginBottom: 6 }}>{act.label}</h3>
      <p className="fine">
        Your file stays in this browser. It is read and fingerprinted here, you choose what to
        redact, and only the text you approve goes on the record, signed by your wallet. The
        document type is <em>your</em> label: the panel decides from the content what a document
        actually is, and a wrong label counts against the side that chose it.
      </p>

      {!address ? (
        <p className="notice notice-dim" style={{ marginTop: 12 }}>
          Connect a wallet from the top of the page to add evidence in your own name.
        </p>
      ) : (
        <>
          <div className="form-grid" style={{ marginTop: 14 }}>
            <div className="field" style={{ marginBottom: 8 }}>
              <label htmlFor="upload-file">File</label>
              <input key={inputKey} id="upload-file" type="file" onChange={(e) => void choose(e.target.files?.[0] ?? null)} />
            </div>
            <div className="field" style={{ marginBottom: 8 }}>
              <label htmlFor="upload-class">Document type</label>
              <select id="upload-class" value={declaredClass} onChange={(e) => setDeclaredClass(e.target.value)}>
                {UPLOAD_CLASSES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 8 }}>
              <label htmlFor="upload-label">Label (optional)</label>
              <input id="upload-label" type="text" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="March service invoice" />
            </div>
            <div className="field" style={{ marginBottom: 8 }}>
              <label htmlFor="upload-date">Document date</label>
              <input id="upload-date" type="date" value={captureDate} onChange={(e) => setCaptureDate(e.target.value)} />
            </div>
          </div>
          {reading ? <p className="fine">Reading the file…</p> : null}
          <ErrorNotice error={error} />
        </>
      )}

      {prepared ? (
        <>
          <div className="panel" style={{ marginTop: 12 }}>
            {prepared.status === "EXTRACTED" ? (
              <>
                <p className="muted small">
                  This is exactly the text that will be judged, and public. Select a passage and add it
                  to remove it; the fingerprint is taken after your redactions.
                  {prepared.original.length >= PER_ITEM_TEXT_CAP - 200
                    ? ` Only the first ${PER_ITEM_TEXT_CAP.toLocaleString("en-US")} characters of a document can be judged.`
                    : ""}
                </p>
                <textarea
                  readOnly
                  rows={8}
                  className="mono"
                  aria-label="Evidence text to redact"
                  style={{ marginTop: 10, fontSize: 12.5 }}
                  value={prepared.original}
                  onSelect={(e) => {
                    const el = e.target as HTMLTextAreaElement;
                    setSel({ start: el.selectionStart, end: el.selectionEnd });
                  }}
                />
                <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 6 }}>
                  <button
                    className="btn btn-ghost"
                    disabled={!sel || sel.start === sel.end}
                    onClick={() => {
                      if (!sel || sel.start === sel.end) return;
                      const overlaps = spans.some((s) => sel.start < s.end && s.start < sel.end);
                      if (!overlaps) setSpans((s) => [...s, sel].sort((a, b) => a.start - b.start));
                    }}
                  >
                    Redact the selection
                  </button>
                  {spans.map((s, i) => {
                    const t = prepared.original.slice(s.start, s.end).replace(/\s+/g, " ").trim();
                    return (
                      <span key={i} className="tag redaction-span">
                        “{t.length > 36 ? `${t.slice(0, 34)}…` : t}”
                        <button
                          type="button"
                          className="tag-remove"
                          aria-label="Remove this redaction"
                          onClick={() => setSpans((all) => all.filter((_, j) => j !== i))}
                        >
                          ✕
                        </button>
                      </span>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="notice notice-dim">
                The text of {prepared.name} could not be extracted: only plain text and PDFs with
                embedded text can be read. It can still enter the record as a fingerprint, and the
                panel is told its content is unknown.
              </p>
            )}
          </div>

          <div className="panel" style={{ marginTop: 12 }}>
            <p className="muted small">
              Odometer readings typed here are what the contract checks mileage against; a reading
              that appears only in free text can never raise a mileage flag. Trouble codes are
              normalized in code, and what a code means stays with the panel.
            </p>
            <div className="stack" style={{ gap: 8, marginTop: 12 }}>
              {rows.map((r, i) => (
                <div key={i} className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                  <input type="date" aria-label="Date on the document" style={{ width: 160 }} value={r.docDate} onChange={(e) => setRow(i, { docDate: e.target.value })} />
                  <input type="number" min={0} placeholder="Odometer" aria-label="Odometer reading" style={{ width: 130 }} value={r.odometerReading} onChange={(e) => setRow(i, { odometerReading: e.target.value })} />
                  <select aria-label="Unit" style={{ width: 80 }} value={r.odometerUnit} onChange={(e) => setRow(i, { odometerUnit: e.target.value })}>
                    <option value="MILES">mi</option>
                    <option value="KM">km</option>
                  </select>
                  <input type="text" placeholder="Trouble code" aria-label="Trouble code, for example P0301" className="mono-input" style={{ width: 130 }} value={r.diagnosticCode} onChange={(e) => setRow(i, { diagnosticCode: e.target.value.toUpperCase() })} />
                  <input type="text" placeholder="Where in the document" aria-label="Where in the document" style={{ flex: 1, minWidth: 160 }} value={r.sourceField} onChange={(e) => setRow(i, { sourceField: e.target.value })} />
                  <button className="btn btn-quiet" aria-label="Remove this reading" title="Remove this reading" onClick={() => setRows((all) => all.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 6 }}>
              <button
                className="btn btn-quiet"
                disabled={rows.length >= config.max_obs_rows_per_item}
                onClick={() => setRows((all) => [...all, { ...EMPTY_ROW, docDate: captureDate }])}
              >
                Add a reading
              </button>
              {suggestedCodes.map((c) => (
                <button
                  key={c}
                  className="btn btn-quiet"
                  onClick={() => setRows((all) => [...all, { ...EMPTY_ROW, docDate: captureDate, diagnosticCode: c }])}
                >
                  Add trouble code {c} from the text
                </button>
              ))}
            </div>
            {rowProblem && rows.length > 0 ? <p className="fine" style={{ marginTop: 8 }}>{sentence(rowProblem)}</p> : null}
          </div>

          <div className="panel panel-signal" style={{ marginTop: 12 }}>
            <p className="small" style={{ fontWeight: 600 }}>
              {PUBLICITY_STATEMENT}
            </p>
            <label className="row small" style={{ marginTop: 12, cursor: "pointer", gap: 10 }}>
              <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)} />
              I understand that this text is public forever the moment it is published.
            </label>
            {declined ? (
              <div className="notice notice-dim" style={{ marginTop: 12 }}>
                You declined to sign. The item can still be published unsigned, and the record will say
                so; or sign it after all.
                <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
                  <button className="btn btn-primary" disabled={busy} onClick={() => void publish(true)}>
                    Sign and publish
                  </button>
                  <button className="btn btn-ghost" disabled={busy} onClick={() => void publish(false)}>
                    Publish unsigned
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="btn btn-primary"
                style={{ marginTop: 12 }}
                disabled={!acked || busy || Boolean(rowProblem && rows.length > 0) || (prepared.status === "EXTRACTED" && !judged)}
                onClick={() => void publish(true)}
              >
                {busy ? "Publishing…" : "Sign and publish"}
              </button>
            )}
            <p className="fine" style={{ marginTop: 10 }}>
              Two wallet prompts: a signature over the fingerprints, which costs nothing, then the
              transaction that writes the item.
            </p>
          </div>
        </>
      ) : null}
      <TxFlow p={progress} />
    </div>
  );
}
