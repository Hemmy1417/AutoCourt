"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { actsFor, type Act } from "../../../lib/acts";
import { attestationMessage } from "../../../lib/attest";
import { api, ApiFailure, EXPLORER, shortHash } from "../../components/api";
import {
  CopyText,
  Empty,
  ErrorNotice,
  Journey,
  PUBLICITY_STATEMENT,
  Spinner,
  StateChip,
} from "../../components/bits";

const EVIDENCE_CLASSES = [
  "SELLER_DECLARATION",
  "BUYER_DECLARATION",
  "MECHANIC_REPORT",
  "DIAGNOSTIC_SCANNER_REPORT",
  "SERVICE_INVOICE",
  "VEHICLE_HISTORY_RECORD",
  "GOVERNMENT_IMPORT_INSPECTION_DOCUMENT",
  "IMAGE",
  "VIDEO",
  "OCR_EXTRACTED_TEXT",
  "MANUAL_OBSERVATION",
  "EXTERNAL_SOURCE_RESULT",
];

interface Detail {
  id: string;
  state: string;
  onChainId: string | null;
  identityStatus: string;
  registryJson: string;
  myRole: "SELLER" | "BUYER";
  packetVersion: number;
  vehicle: {
    vin: string;
    vinCheckDigitOk: boolean;
    make: string;
    model: string;
    year: number;
    claims: {
      id: string;
      claimId: string;
      type: string;
      declaredValue: string;
      disputes: { disputerId: string; note: string }[];
    }[];
  };
  evidenceItems: EvidenceRow[];
  runs: {
    runNumber: number;
    status: string;
    kind: string;
    txHash: string | null;
    errorText: string;
  }[];
}

interface EvidenceRow {
  id: string;
  evidenceId: string;
  declaredClass: string;
  declaredLabel: string;
  uploaderId: string;
  uploaderRole: string;
  status: string;
  mimeType: string;
  fileSha256: string;
  textSha256: string;
  redactionStatus: string;
  consentedAt: string | null;
  onChainTxHash: string | null;
  extraction: { status: string; normalizedText: string } | null;
  observations: {
    docDate: string;
    odometerReading: number | null;
    odometerUnit: string | null;
    diagnosticCode: string | null;
    sourceField: string;
  }[];
}

// Screens 6 + 7 + 8 — the assessment dossier.
export default function AssessmentDossier() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [meId, setMeId] = useState<string>("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<Detail>(`/api/assessments/${id}`);
      setDetail(d);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [id]);

  useEffect(() => {
    load();
    api<{ id: string }>("/api/me").then((m) => setMeId(m.id)).catch(() => {});
  }, [load]);

  // Screen 8's engine: while a run is in flight, the page keeps itself
  // honest by re-reading the record.
  useEffect(() => {
    if (!detail) return;
    const busy = detail.state === "SUBMITTED" || detail.state === "PROCESSING";
    if (busy && !pollRef.current) {
      pollRef.current = setInterval(load, 8000);
    }
    if (!busy && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [detail, load]);

  if (error && !detail) return <ErrorNotice error={error} />;
  if (!detail)
    return (
      <div className="row" style={{ justifyContent: "center", padding: 60 }}>
        <Spinner />
      </div>
    );

  const successRuns = detail.runs.filter((r) => r.status === "SUCCESS").length;
  const acts = actsFor({
    state: detail.state,
    role: detail.myRole,
    evidenceCount: detail.evidenceItems.length,
    unconsentedCount: detail.evidenceItems.filter((i) => !i.consentedAt).length,
    successRuns,
    maxRuns: 4,
    newAppealEvidenceCount: detail.evidenceItems.filter(
      (i) => !i.onChainTxHash && detail.state === "ADJUDICATED",
    ).length,
    freshDisputeCount: 0, // refined on the appeal screen
    hasOnChainId: Boolean(detail.onChainId),
  });

/**
 * What the public VIN registry said — the one fact on the record that no
 * party supplied. Absence of confirmation is shown as absence, never as
 * an accusation.
 */
function IdentityRow({
  status,
  registryJson,
  declared,
}: {
  status: string;
  registryJson: string;
  declared: string;
}) {
  if (!status) return null;
  let reg: Record<string, string> = {};
  try {
    reg = JSON.parse(registryJson || "{}") as Record<string, string>;
  } catch {
    reg = {};
  }
  const decoded = [reg.ModelYear, reg.Make, reg.Model]
    .filter(Boolean)
    .join(" ");
  const body: Record<string, string> = {
    CONFIRMED: decoded
      ? `the VIN decodes to ${decoded}${reg.BodyClass ? ` (${reg.BodyClass})` : ""} — consistent with this listing`
      : "the VIN decodes consistently with this listing",
    MISMATCH: `the VIN decodes to ${decoded || "a different vehicle"}${reg.BodyClass ? ` (${reg.BodyClass})` : ""}, not a ${declared}. Every claim is capped until this is reconciled.`,
    UNDECODABLE: "the registry could not decode this VIN — no confirmation either way, and not evidence against anyone",
    SOURCE_UNAVAILABLE: "the registry was unreachable when this record opened — no confirmation either way, and not evidence against anyone",
  };
  const tone =
    status === "MISMATCH"
      ? "notice notice-warn"
      : status === "CONFIRMED"
        ? "notice notice-ok"
        : "notice";
  return (
    <div className={tone} style={{ marginTop: 12, maxWidth: 620 }}>
      <strong>Independent identity check — {status.replace(/_/g, " ").toLowerCase()}.</strong>{" "}
      {body[status] ?? status}
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        Read from the public federal VIN registry by every validator
        itself, before this record existed. No party supplied it.
      </div>
    </div>
  );
}

  return (
    <section className="section">
      <div className="spread" style={{ marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <h2>
            {detail.vehicle.year} {detail.vehicle.make} {detail.vehicle.model}
          </h2>
          <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
            <span className="tag">{detail.vehicle.vin}</span>
            <span className="tag">
              check digit{" "}
              {detail.vehicle.vinCheckDigitOk ? "consistent" : "not consistent (a fact, not a verdict)"}
            </span>
            {detail.onChainId ? (
              <span className="tag">{detail.onChainId}</span>
            ) : null}
          </div>
          <IdentityRow
            status={detail.identityStatus}
            registryJson={detail.registryJson}
            declared={`${detail.vehicle.year} ${detail.vehicle.make} ${detail.vehicle.model}`}
          />
        </div>
        <StateChip state={detail.state} />
      </div>

      <div className="card card-tight" style={{ marginBottom: 22 }}>
        <Journey state={detail.state} />
      </div>

      <div className="dossier">
        <aside className="dossier-side">
          <ClaimsCard detail={detail} meId={meId} onChange={load} />
          <ActsCard
            acts={acts}
            detail={detail}
            onChange={load}
            router={router}
          />
          {detail.myRole === "SELLER" ? <ShareCard id={detail.id} /> : null}
        </aside>

        <div className="stack" style={{ gap: 18 }}>
          {detail.state === "SUBMITTED" || detail.state === "PROCESSING" ? (
            <ProcessingCard detail={detail} />
          ) : null}
          {detail.state === "FAILED" ? <FailureCard detail={detail} /> : null}
          {detail.state === "ADJUDICATED" ? (
            <div className="card">
              <div className="spread">
                <h3>The verdict stands</h3>
                <Link
                  className="btn btn-primary"
                  href={`/assessments/${detail.id}/report`}
                >
                  Open the report
                </Link>
              </div>
              <p className="muted small" style={{ marginTop: 8 }}>
                Run {successRuns} of at most 4. New evidence or a new dispute
                opens an appeal — prior runs stay on the record, immutable.
              </p>
            </div>
          ) : null}

          <EvidenceSection detail={detail} meId={meId} onChange={load} />
        </div>
      </div>
    </section>
  );
}

function ClaimsCard({
  detail,
  meId,
  onChange,
}: {
  detail: Detail;
  meId: string;
  onChange: () => void;
}) {
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const isBuyer = detail.myRole === "BUYER";

  async function fileDispute() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/assessments/${detail.id}/disputes`, {
        method: "POST",
        body: JSON.stringify({ claimRowIds: picked, note }),
      });
      setSelecting(false);
      setPicked([]);
      setNote("");
      onChange();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-tight">
      <div className="card-title">
        <h3>Claims</h3>
        {isBuyer && !selecting ? (
          <button className="btn btn-quiet" onClick={() => setSelecting(true)}>
            Dispute…
          </button>
        ) : null}
      </div>
      <div className="stack" style={{ gap: 10 }}>
        {detail.vehicle.claims.map((c) => (
          <div key={c.id}>
            <div className="row" style={{ gap: 8 }}>
              {selecting ? (
                <input
                  type="checkbox"
                  checked={picked.includes(c.id)}
                  onChange={(e) =>
                    setPicked((p) =>
                      e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id),
                    )
                  }
                  style={{ width: "auto" }}
                />
              ) : null}
              <span className="tag">{c.claimId}</span>
              <b className="small">{c.type.replaceAll("_", " ")}</b>
            </div>
            <p className="small" style={{ marginTop: 3 }}>
              “{c.declaredValue}”
            </p>
            {c.disputes.length > 0 ? (
              <span className="chip chip-warn" style={{ marginTop: 5 }}>
                <span className="dot" />
                disputed by {c.disputes.length} part
                {c.disputes.length === 1 ? "y" : "ies"}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {selecting ? (
        <div style={{ marginTop: 12 }}>
          <div className="field">
            <label>Why (optional, on the record)</label>
            <input
              type="text"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="odometer looks off against the history"
            />
          </div>
          <ErrorNotice error={error} />
          <div className="row">
            <button
              className="btn btn-primary"
              disabled={busy || picked.length === 0}
              onClick={fileDispute}
            >
              {busy ? <Spinner /> : "Record the dispute"}
            </button>
            <button className="btn btn-quiet" onClick={() => setSelecting(false)}>
              Cancel
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            A dispute is your recorded assertion, not a fact — it gives your
            evidence against these claims its standing, and the panel is
            told exactly that.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ActsCard({
  acts,
  detail,
  onChange,
  router,
}: {
  acts: Act[];
  detail: Detail;
  onChange: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function run(act: Act) {
    setBusy(act.id);
    setError(null);
    try {
      if (act.id === "submit") {
        await api(`/api/assessments/${detail.id}/submit`, { method: "POST" });
      } else if (act.id === "adjudicate" || act.id === "retry") {
        await api(`/api/assessments/${detail.id}/adjudicate`, {
          method: "POST",
        });
      } else if (act.id === "appeal") {
        router.push(`/assessments/${detail.id}/appeal`);
        return;
      }
      onChange();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const actionable = ["submit", "adjudicate", "appeal", "retry"];
  return (
    <div className="card card-tight">
      <h3 style={{ marginBottom: 10 }}>Next steps</h3>
      <div className="stack" style={{ gap: 8 }}>
        {acts
          .filter((a) => actionable.includes(a.id))
          .map((a) =>
            a.available ? (
              <button
                key={a.id}
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={() => run(a)}
              >
                {busy === a.id ? <Spinner /> : a.label}
              </button>
            ) : (
              <div key={a.id} className="small muted" title={a.reason}>
                <b style={{ color: "var(--faint)" }}>{a.label}</b> — {a.reason}
              </div>
            ),
          )}
      </div>
      <ErrorNotice error={error} />
      {detail.onChainId ? (
        <>
          <div className="divider" />
          <Link
            className="small"
            style={{ color: "var(--signal-deep)", fontWeight: 700 }}
            href={`/assessments/${detail.id}/receipt`}
          >
            Intake receipt — is my evidence in the judged record? →
          </Link>
        </>
      ) : null}
    </div>
  );
}

function ShareCard({ id }: { id: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  return (
    <div className="card card-tight">
      <h3 style={{ marginBottom: 8 }}>Share with a buyer</h3>
      <p className="muted" style={{ fontSize: 12.5 }}>
        A signed link, 14-day wall-clock expiry, revocable in Settings. It
        governs the app&apos;s copy only — anything adjudicated is already
        public on the chain.
      </p>
      <ErrorNotice error={error} />
      {token ? (
        <div style={{ marginTop: 10 }}>
          <CopyText
            value={`${window.location.origin}/share/${token}`}
            short={`${window.location.origin.replace(/^https?:\/\//, "")}/share/${token.slice(0, 8)}…`}
          />
          <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
            Copy it now — the raw link is shown exactly once.
          </p>
        </div>
      ) : (
        <button
          className="btn btn-ghost"
          style={{ marginTop: 10 }}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const r = await api<{ token: string }>(
                `/api/assessments/${id}/share`,
                { method: "POST", body: JSON.stringify({}) },
              );
              setToken(r.token);
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner /> : "Create a share link"}
        </button>
      )}
    </div>
  );
}

function ProcessingCard({ detail }: { detail: Detail }) {
  return (
    <div className="card">
      <div className="row">
        <Spinner />
        <h3>
          {detail.state === "SUBMITTED"
            ? "Packet queued for the chain"
            : "The panel is judging the record"}
        </h3>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>
        Every step is a transaction: the record is entered item by item,
        sealed under its manifest root, then judged by validators who must
        agree on every finding. This page refreshes itself; nothing here
        needs you.
      </p>
      <AttemptsFeed detail={detail} />
    </div>
  );
}

function FailureCard({ detail }: { detail: Detail }) {
  const last = detail.runs.find((r) => r.status !== "SUCCESS");
  return (
    <div className="card">
      <h3>The last attempt did not survive consensus</h3>
      {last?.errorText ? (
        <p className="notice notice-bad" style={{ marginTop: 10 }}>
          {last.errorText}
        </p>
      ) : null}
      <p className="muted small" style={{ marginTop: 10 }}>
        Nothing was recorded — the prior record stands. A retry is a new
        attempt with its own transaction hash.
      </p>
      <AttemptsFeed detail={detail} />
    </div>
  );
}

function AttemptsFeed({ detail }: { detail: Detail }) {
  if (detail.runs.length === 0) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div className="stack" style={{ gap: 8 }}>
        {detail.runs.map((r, i) => (
          <div key={i} className="row small" style={{ flexWrap: "wrap" }}>
            <span
              className={`chip ${
                r.status === "SUCCESS"
                  ? "chip-ok"
                  : r.status === "REJECTED"
                    ? "chip-dim"
                    : "chip-bad"
              }`}
            >
              <span className="dot" />
              {r.kind === "RE_ADJUDICATION" ? "appeal " : ""}
              {r.status.toLowerCase()}
            </span>
            {r.txHash ? (
              <a
                className="tag"
                href={`${EXPLORER}/tx/${r.txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                {shortHash(r.txHash)}
              </a>
            ) : null}
            {r.errorText ? (
              <span className="muted">{r.errorText}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── evidence (screen 6) + diagnostics input (screen 7) ─────────────── */

function EvidenceSection({
  detail,
  meId,
  onChange,
}: {
  detail: Detail;
  meId: string;
  onChange: () => void;
}) {
  const canAdd = detail.state === "DRAFT" || detail.state === "ADJUDICATED";
  return (
    <>
      <div className="spread">
        <h3 style={{ fontSize: 22 }}>The record</h3>
        <span className="muted small">
          {detail.evidenceItems.length} item
          {detail.evidenceItems.length === 1 ? "" : "s"}
        </span>
      </div>
      {detail.evidenceItems.length === 0 ? (
        <Empty>
          The record is empty. Upload the paperwork that backs (or
          contests) the claims — invoices, history reports, scanner dumps,
          photos. Every file is hashed the moment it lands.
        </Empty>
      ) : (
        detail.evidenceItems.map((item) => (
          <EvidenceCard
            key={item.id}
            item={item}
            detail={detail}
            mine={item.uploaderId === meId}
            onChange={onChange}
          />
        ))
      )}
      {canAdd ? <UploadCard detail={detail} onChange={onChange} /> : null}
    </>
  );
}

function EvidenceCard({
  item,
  detail,
  mine,
  onChange,
}: {
  item: EvidenceRow;
  detail: Detail;
  mine: boolean;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"none" | "redact" | "rows" | "consent">(
    "none",
  );
  const editable = mine && !item.consentedAt && detail.state === "DRAFT";
  const editableAppeal =
    mine && !item.consentedAt && detail.state === "ADJUDICATED";

  return (
    <div className="card card-tight">
      <div className="spread" style={{ flexWrap: "wrap" }}>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <span className="tag">{item.evidenceId}</span>
          <b className="small">{item.declaredClass.replaceAll("_", " ")}</b>
          {item.declaredLabel ? (
            <span className="muted small">“{item.declaredLabel}”</span>
          ) : null}
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <span className="tag">{item.uploaderRole.toLowerCase()} upload</span>
          {item.status === "UNEXTRACTED" ? (
            <span className="chip chip-dim">
              <span className="dot" />
              stored, unextracted
            </span>
          ) : null}
          {item.redactionStatus === "REDACTED" ? (
            <span className="chip chip-info">
              <span className="dot" />
              redacted
            </span>
          ) : null}
          {item.consentedAt ? (
            <span className="chip chip-ok">
              <span className="dot" />
              consented
            </span>
          ) : (
            <span className="chip chip-warn">
              <span className="dot" />
              consent pending
            </span>
          )}
          {item.onChainTxHash ? (
            <a
              className="tag"
              href={`${EXPLORER}/tx/${item.onChainTxHash}`}
              target="_blank"
              rel="noreferrer"
            >
              on-chain {shortHash(item.onChainTxHash, 6)}
            </a>
          ) : null}
        </div>
      </div>

      <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
        <button className="btn btn-quiet" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide text" : "Review text"}
        </button>
        {(editable || editableAppeal) && item.status === "EXTRACTED" ? (
          <button
            className="btn btn-quiet"
            onClick={() => setPanel(panel === "redact" ? "none" : "redact")}
          >
            Redact
          </button>
        ) : null}
        {editable || editableAppeal ? (
          <>
            <button
              className="btn btn-quiet"
              onClick={() => setPanel(panel === "rows" ? "none" : "rows")}
            >
              Diagnostics &amp; readings
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setPanel(panel === "consent" ? "none" : "consent")}
            >
              Consent for the packet
            </button>
          </>
        ) : null}
      </div>

      {open ? (
        <pre
          className="mono"
          style={{
            background: "var(--well)",
            borderRadius: 10,
            padding: 14,
            marginTop: 12,
            whiteSpace: "pre-wrap",
            fontSize: 12.5,
            maxHeight: 260,
            overflow: "auto",
          }}
        >
          {item.extraction?.status === "EXTRACTED"
            ? item.extraction.normalizedText
            : "[stored but unextracted — its content is unknown to the record, and the panel is told so]"}
        </pre>
      ) : null}

      {item.observations.length > 0 ? (
        <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
          {item.observations.map((o, i) => (
            <span key={i} className="tag">
              {o.diagnosticCode
                ? `DTC ${o.diagnosticCode}`
                : `${o.docDate}: ${o.odometerReading?.toLocaleString()} ${o.odometerUnit?.toLowerCase()}`}
            </span>
          ))}
        </div>
      ) : null}

      {panel === "redact" ? (
        <RedactPanel item={item} detail={detail} onDone={() => { setPanel("none"); onChange(); }} />
      ) : null}
      {panel === "rows" ? (
        <RowsPanel item={item} detail={detail} onDone={() => { setPanel("none"); onChange(); }} />
      ) : null}
      {panel === "consent" ? (
        <ConsentPanel item={item} detail={detail} onDone={() => { setPanel("none"); onChange(); }} />
      ) : null}
    </div>
  );
}

function RedactPanel({
  item,
  detail,
  onDone,
}: {
  item: EvidenceRow;
  detail: Detail;
  onDone: () => void;
}) {
  const text = item.extraction?.normalizedText ?? "";
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [spans, setSpans] = useState<{ start: number; end: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  return (
    <div style={{ marginTop: 12 }}>
      <p className="muted small">
        Select the passage to remove, then add the span. Redaction re-hashes
        the item; it must happen before consent and is impossible after
        submission.
      </p>
      <textarea
        readOnly
        rows={7}
        className="mono"
        style={{ marginTop: 8, fontSize: 12.5 }}
        value={text}
        onSelect={(e) => {
          const el = e.target as HTMLTextAreaElement;
          setSelStart(el.selectionStart);
          setSelEnd(el.selectionEnd);
        }}
      />
      <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
        <button
          className="btn btn-ghost"
          disabled={selStart === null || selEnd === null || selStart === selEnd}
          onClick={() => {
            if (selStart !== null && selEnd !== null)
              setSpans((s) =>
                [...s, { start: selStart, end: selEnd }].sort(
                  (a, b) => a.start - b.start,
                ),
              );
          }}
        >
          Add span
        </button>
        {spans.map((s, i) => (
          <span key={i} className="tag">
            {s.start}–{s.end}{" "}
            <span
              style={{ cursor: "pointer" }}
              onClick={() => setSpans((all) => all.filter((_, j) => j !== i))}
            >
              ✕
            </span>
          </span>
        ))}
      </div>
      <ErrorNotice error={error} />
      <button
        className="btn btn-primary"
        style={{ marginTop: 10 }}
        disabled={busy || spans.length === 0}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api(
              `/api/assessments/${detail.id}/evidence/${item.id}/redact`,
              { method: "POST", body: JSON.stringify({ spans }) },
            );
            onDone();
          } catch (e) {
            setError(e);
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner /> : `Apply ${spans.length} redaction span(s)`}
      </button>
    </div>
  );
}

function RowsPanel({
  item,
  detail,
  onDone,
}: {
  item: EvidenceRow;
  detail: Detail;
  onDone: () => void;
}) {
  const [rows, setRows] = useState(
    item.observations.length > 0
      ? item.observations.map((o) => ({
          docDate: o.docDate,
          odometerReading: o.odometerReading?.toString() ?? "",
          odometerUnit: o.odometerUnit ?? "MILES",
          diagnosticCode: o.diagnosticCode ?? "",
          sourceField: o.sourceField,
        }))
      : [
          {
            docDate: "",
            odometerReading: "",
            odometerUnit: "MILES",
            diagnosticCode: "",
            sourceField: "",
          },
        ],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  return (
    <div style={{ marginTop: 12 }}>
      <p className="muted small">
        Typed rows are what the contract recomputes mileage conflicts from —
        a reading that lives only in free text can never raise a code flag.
        Diagnostic codes are normalized (P0301 shape) in code; what a code
        MEANS stays with the panel.
      </p>
      <div className="stack" style={{ gap: 8, marginTop: 10 }}>
        {rows.map((r, i) => (
          <div key={i} className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <input
              type="date"
              style={{ width: 150 }}
              value={r.docDate}
              onChange={(e) =>
                setRows((all) =>
                  all.map((x, j) => (j === i ? { ...x, docDate: e.target.value } : x)),
                )
              }
            />
            <input
              type="number"
              placeholder="odometer"
              style={{ width: 120 }}
              value={r.odometerReading}
              onChange={(e) =>
                setRows((all) =>
                  all.map((x, j) =>
                    j === i ? { ...x, odometerReading: e.target.value } : x,
                  ),
                )
              }
            />
            <select
              style={{ width: 92 }}
              value={r.odometerUnit}
              onChange={(e) =>
                setRows((all) =>
                  all.map((x, j) =>
                    j === i ? { ...x, odometerUnit: e.target.value } : x,
                  ),
                )
              }
            >
              <option>MILES</option>
              <option>KM</option>
            </select>
            <input
              type="text"
              placeholder="DTC (P0301)"
              className="mono-input"
              style={{ width: 110 }}
              value={r.diagnosticCode}
              onChange={(e) =>
                setRows((all) =>
                  all.map((x, j) =>
                    j === i ? { ...x, diagnosticCode: e.target.value.toUpperCase() } : x,
                  ),
                )
              }
            />
            <input
              type="text"
              placeholder="where in the document"
              style={{ flex: 1, minWidth: 140 }}
              value={r.sourceField}
              onChange={(e) =>
                setRows((all) =>
                  all.map((x, j) =>
                    j === i ? { ...x, sourceField: e.target.value } : x,
                  ),
                )
              }
            />
            <button
              className="btn btn-quiet"
              disabled={rows.length <= 1}
              onClick={() => setRows((all) => all.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button
          className="btn btn-quiet"
          disabled={rows.length >= 12}
          onClick={() =>
            setRows((all) => [
              ...all,
              {
                docDate: "",
                odometerReading: "",
                odometerUnit: "MILES",
                diagnosticCode: "",
                sourceField: "",
              },
            ])
          }
        >
          Add row
        </button>
        <button
          className="btn btn-primary"
          disabled={busy || rows.some((r) => !r.docDate)}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api(
                `/api/assessments/${detail.id}/evidence/${item.id}/observations`,
                { method: "POST", body: JSON.stringify({ rows }) },
              );
              onDone();
            } catch (e) {
              setError(e);
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner /> : "Save typed rows"}
        </button>
      </div>
      <ErrorNotice error={error} />
    </div>
  );
}

function ConsentPanel({
  item,
  detail,
  onDone,
}: {
  item: EvidenceRow;
  detail: Detail;
  onDone: () => void;
}) {
  const [acked, setAcked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <div
      style={{
        marginTop: 12,
        background: "var(--signal-soft)",
        borderRadius: 12,
        padding: 14,
      }}
    >
      <p className="small" style={{ fontWeight: 600 }}>
        {PUBLICITY_STATEMENT}
      </p>
      <label className="row small" style={{ marginTop: 10, cursor: "pointer" }}>
        <input
          type="checkbox"
          style={{ width: "auto" }}
          checked={acked}
          onChange={(e) => setAcked(e.target.checked)}
        />
        I understand: once adjudicated, this item&apos;s text is public
        forever.
      </label>
      <ErrorNotice error={error} />
      <button
        className="btn btn-primary"
        style={{ marginTop: 10 }}
        disabled={!acked || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            // Attest to the FINAL bytes with the same wallet that
            // uploaded them. Declining the prompt still consents — the
            // item is simply recorded as unsigned, which is honest.
            let signature = "";
            try {
              signature = await signAttestation({
                evidenceId: item.evidenceId,
                textSha256: item.textSha256,
                fileSha256: item.fileSha256,
              });
            } catch {
              signature = "";
            }
            await api(
              `/api/assessments/${detail.id}/evidence/${item.id}/consent`,
              {
                method: "POST",
                body: JSON.stringify({
                  consentVersion: "publicity-statement-1",
                  signature,
                }),
              },
            );
            onDone();
          } catch (e) {
            setError(e);
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner /> : `Consent ${item.evidenceId} for the packet`}
      </button>
    </div>
  );
}

/**
 * Ask the connected wallet to sign the attestation. Returns "" when no
 * wallet answers or the user declines — an unsigned item is a recorded
 * fact, never a blocked upload.
 */
async function signAttestation(opts: {
  evidenceId: string;
  textSha256: string;
  fileSha256: string;
}): Promise<string> {
  const provider = await new Promise<
    { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } | null
  >((resolve) => {
    let done = false;
    const onAnnounce = (e: Event) => {
      if (done) return;
      done = true;
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve((e as CustomEvent).detail?.provider ?? null);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      if (done) return;
      done = true;
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve(
        (window as unknown as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } })
          .ethereum ?? null,
      );
    }, 400);
  });
  if (!provider) return "";
  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];
  const address = accounts?.[0];
  if (!address) return "";
  return (await provider.request({
    method: "personal_sign",
    params: [attestationMessage(opts), address],
  })) as string;
}

function UploadCard({
  detail,
  onChange,
}: {
  detail: Detail;
  onChange: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [declaredClass, setDeclaredClass] = useState("SERVICE_INVOICE");
  const [label, setLabel] = useState("");
  const [captureDate, setCaptureDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  return (
    <div className="card card-tight" style={{ border: "1.5px dashed var(--hairline)", boxShadow: "none" }}>
      <h3 style={{ marginBottom: 6 }}>
        {detail.state === "ADJUDICATED" ? "Add appeal evidence" : "Add evidence"}
      </h3>
      <p className="muted" style={{ fontSize: 12.5 }}>
        The class below is YOUR label — the panel judges from the content
        what the document actually is, and a mislabel counts against the
        case it was chosen to help. Files are typed by their bytes, never
        their extension.
      </p>
      <div className="row" style={{ marginTop: 12, flexWrap: "wrap", alignItems: "start" }}>
        <div className="field" style={{ flex: 1, minWidth: 180, marginBottom: 8 }}>
          <label>File</label>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="field" style={{ minWidth: 210, marginBottom: 8 }}>
          <label>Declared class</label>
          <select
            value={declaredClass}
            onChange={(e) => setDeclaredClass(e.target.value)}
          >
            {EVIDENCE_CLASSES.map((c) => (
              <option key={c} value={c}>
                {c.replaceAll("_", " ").toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 8 }}>
          <label>Label (optional)</label>
          <input
            type="text"
            maxLength={80}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="March service invoice"
          />
        </div>
        <div className="field" style={{ minWidth: 150, marginBottom: 8 }}>
          <label>Document date</label>
          <input
            type="date"
            value={captureDate}
            onChange={(e) => setCaptureDate(e.target.value)}
          />
        </div>
      </div>
      <ErrorNotice error={error} />
      <button
        className="btn btn-primary"
        disabled={!file || busy}
        onClick={async () => {
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            const form = new FormData();
            form.set("file", file);
            form.set("declaredClass", declaredClass);
            form.set("declaredLabel", label);
            form.set("captureDate", captureDate);
            await api(`/api/assessments/${detail.id}/evidence`, {
              method: "POST",
              body: form,
            });
            setFile(null);
            setLabel("");
            onChange();
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner /> : "Upload to the record"}
      </button>
    </div>
  );
}
