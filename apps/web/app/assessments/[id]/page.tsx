"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { actsFor, awaitingAppeal, type Act } from "../../../lib/acts";
import { attestationMessage } from "../../../lib/attest";
import {
  attemptLabel,
  claimTypeLabel,
  EVIDENCE_CLASSES,
  evidenceClassLabel,
  failureText,
  formatDocDate,
  formatOdometer,
  identityLabel,
  plural,
  recordNumber,
  registryName,
  sentence,
  vehicleTitle,
} from "../../../lib/present";
import { api, EXPLORER, shortHash } from "../../components/api";
import {
  Chip,
  CopyText,
  Empty,
  ErrorNotice,
  IdTag,
  Journey,
  Loading,
  PageError,
  PUBLICITY_STATEMENT,
  Spinner,
  StateChip,
} from "../../components/bits";

/** An upload can be labelled anything except the one lane only validators fill. */
const UPLOAD_CLASSES = EVIDENCE_CLASSES.filter(
  (c) => c.value !== "EXTERNAL_SOURCE_RESULT",
);

interface Detail {
  id: string;
  state: string;
  onChainId: string | null;
  identityStatus: string;
  registryJson: string;
  maxRuns: number | null;
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
    createdAt: string;
  }[];
}

interface EvidenceRow {
  id: string;
  evidenceId: string;
  declaredClass: string;
  declaredLabel: string;
  uploaderId: string;
  uploaderRole: string;
  lane: string;
  anchorUrl: string | null;
  status: string;
  mimeType: string;
  fileSha256: string;
  textSha256: string;
  redactionStatus: string;
  consentedAt: string | null;
  onChainTxHash: string | null;
  createdAt: string;
  extraction: { status: string; normalizedText: string } | null;
  observations: {
    docDate: string;
    odometerReading: number | null;
    odometerUnit: string | null;
    diagnosticCode: string | null;
    sourceField: string;
  }[];
}

interface JobRow {
  kind: string;
  state: string;
  lastError: string;
}

/** The writes that must all land before a packet is sealed. */
const SUBMISSION_STEPS = new Set(["CREATE", "SUBMIT_EVIDENCE", "SUBMIT_ANCHOR", "SEAL"]);

/**
 * Where a submitted packet actually is. "Submitted" alone cannot say:
 * the same state covers writes still landing, a sealed packet waiting for
 * someone to request the panel, and a seal that failed for good.
 */
function submissionStatus(jobs: JobRow[] | null) {
  if (!jobs) return null;
  const steps = jobs.filter((j) => SUBMISSION_STEPS.has(j.kind));
  const failed = steps.find((j) => j.state === "FAILED") ?? null;
  const pending = steps.filter((j) => j.state !== "DONE" && j.state !== "FAILED").length;
  const done = steps.filter((j) => j.state === "DONE").length;
  return { failed, pending, done, total: steps.length };
}

/** True only when the contract's limit is known and has been reached. */
function runsExhausted(detail: Detail, successRuns: number): boolean {
  return detail.maxRuns !== null && successRuns >= detail.maxRuns;
}

/** The one act that belongs to each stage; the rest are not a question yet. */
const STAGE_ACT: Record<string, Act["id"]> = {
  DRAFT: "submit",
  SUBMITTED: "adjudicate",
  ADJUDICATED: "appeal",
  FAILED: "retry",
};

// Screens 6 + 7 + 8 — the assessment dossier.
export default function AssessmentDossier() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [meId, setMeId] = useState<string>("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<Detail>(`/api/assessments/${id}`);
      if (d.state === "SUBMITTED" || d.state === "PROCESSING") {
        const j = await api<{ jobs: JobRow[] }>(`/api/assessments/${id}/jobs`).catch(
          () => null,
        );
        setJobs(j?.jobs ?? null);
      } else {
        setJobs(null);
      }
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

  if (error && !detail) return <PageError error={error} />;
  if (!detail) return <Loading />;

  const successRuns = detail.runs.filter((r) => r.status === "SUCCESS").length;
  const submission = detail.state === "SUBMITTED" ? submissionStatus(jobs) : null;
  const acts = actsFor({
    sealFailed: Boolean(submission?.failed),
    state: detail.state,
    role: detail.myRole,
    evidenceCount: detail.evidenceItems.length,
    unconsentedCount: detail.evidenceItems.filter((i) => !i.consentedAt).length,
    pendingAnchorCount: detail.evidenceItems.filter(
      (i) => i.status === "PENDING_ENTRY",
    ).length,
    successRuns,
    // From the contract, never from memory. If it could not be read,
    // do not block the act — the contract refuses for itself, and a
    // guess here would deny an appeal the contract would have allowed.
    maxRuns: detail.maxRuns ?? Number.POSITIVE_INFINITY,
    newAppealEvidenceCount:
      detail.state === "ADJUDICATED"
        ? detail.evidenceItems.filter((i) => awaitingAppeal(i, detail.runs)).length
        : 0,
    freshDisputeCount: 0, // refined on the appeal screen
    hasOnChainId: Boolean(detail.onChainId),
  });

  return (
    <section className="section">
      <div className="spread" style={{ marginBottom: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h2>{vehicleTitle(detail.vehicle)}</h2>
          <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
            <span className="tag">
              VIN <span className="tag-mono">{detail.vehicle.vin}</span>
            </span>
            <span className="tag">
              {detail.vehicle.vinCheckDigitOk
                ? "Check digit consistent"
                : "Check digit inconsistent — a fact, not a verdict"}
            </span>
            {detail.onChainId ? (
              <span className="tag" title={`On-chain record ${detail.onChainId}`}>
                {recordNumber(detail.onChainId)}
              </span>
            ) : null}
            <span className="tag">
              {detail.myRole === "SELLER" ? "You are the seller" : "Shared with you as a buyer"}
            </span>
          </div>
        </div>
        <StateChip state={detail.state} />
      </div>

      <IdentityRow
        status={detail.identityStatus}
        registryJson={detail.registryJson}
        declared={vehicleTitle(detail.vehicle)}
      />

      <div className="card card-tight" style={{ margin: "18px 0 22px" }}>
        <Journey state={detail.state} />
      </div>

      <div className="dossier">
        <aside className="dossier-side">
          <ClaimsCard detail={detail} onChange={load} />
          <ActsCard
            acts={acts}
            detail={detail}
            onChange={load}
            router={router}
          />
          {detail.myRole === "SELLER" ? <ShareCard id={detail.id} /> : null}
        </aside>

        <div className="stack" style={{ gap: 18 }}>
          {detail.state === "PROCESSING" ? <ProcessingCard detail={detail} /> : null}
          {detail.state === "SUBMITTED" ? (
            submission?.failed ? (
              <SealFailedCard job={submission.failed} />
            ) : submission && submission.pending === 0 && submission.total > 0 ? (
              <div className="card">
                <h3>Sealed and ready for the panel</h3>
                <p className="muted small" style={{ marginTop: 8 }}>
                  Every item is on chain and the packet is sealed under its
                  manifest root. Either party can now request adjudication.
                </p>
              </div>
            ) : (
              <ProcessingCard
                detail={detail}
                progress={submission ? `${submission.done} of ${submission.total} steps complete` : ""}
              />
            )
          ) : null}
          {detail.state === "FAILED" ? <FailureCard detail={detail} /> : null}
          {detail.state === "ADJUDICATED" ? (
            <div className="card">
              <div className="spread" style={{ flexWrap: "wrap" }}>
                <h3>The verdict stands</h3>
                <Link
                  className="btn btn-primary"
                  href={`/assessments/${detail.id}/report`}
                >
                  Open the report
                </Link>
              </div>
              <p className="muted small" style={{ marginTop: 8 }}>
                {runsExhausted(detail, successRuns)
                  ? `This is run ${successRuns} of ${detail.maxRuns}, the most the contract allows, so this verdict is final. Earlier runs stay on the record, unchanged.`
                  : `${
                      detail.maxRuns === null
                        ? `This is run ${successRuns}.`
                        : `This is run ${successRuns} of up to ${detail.maxRuns}.`
                    } New evidence or a new dispute opens an appeal; earlier runs stay on the record, unchanged.`}
              </p>
            </div>
          ) : null}

          <EvidenceSection detail={detail} meId={meId} onChange={load} />
        </div>
      </div>
    </section>
  );
}

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
  const decoded = [reg.ModelYear, registryName(reg.Make), registryName(reg.Model)]
    .filter(Boolean)
    .join(" ");
  const body = reg.BodyClass ? ` (${registryName(reg.BodyClass)})` : "";
  const text: Record<string, string> = {
    CONFIRMED: decoded
      ? `The VIN decodes to a ${decoded}${body}, consistent with this listing.`
      : "The VIN decodes consistently with this listing.",
    MISMATCH: `The VIN decodes to ${decoded ? `a ${decoded}${body}` : "a different vehicle"}, not a ${declared}. Every claim is capped until this is reconciled.`,
    UNDECODABLE:
      "The registry could not decode this VIN. That is no confirmation either way, and not evidence against anyone.",
    SOURCE_UNAVAILABLE:
      "The registry could not be reached when this record opened. That is no confirmation either way, and not evidence against anyone.",
  };
  const tone =
    status === "MISMATCH"
      ? "notice notice-warn"
      : status === "CONFIRMED"
        ? "notice notice-ok"
        : "notice notice-dim";
  return (
    <div className={tone} style={{ maxWidth: 720 }}>
      <strong>Independent identity check: {identityLabel(status)}.</strong>{" "}
      {text[status] ?? ""}
      <div className="fine" style={{ marginTop: 6, color: "inherit", opacity: 0.8 }}>
        Read from the public federal VIN registry by every validator itself,
        before this record existed. No party supplied it.
      </div>
    </div>
  );
}

function ClaimsCard({
  detail,
  onChange,
}: {
  detail: Detail;
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
      <div className="stack" style={{ gap: 14 }}>
        {detail.vehicle.claims.map((c) => (
          <div key={c.id}>
            <label className="row" style={{ gap: 8, cursor: selecting ? "pointer" : "default" }}>
              {selecting ? (
                <input
                  type="checkbox"
                  checked={picked.includes(c.id)}
                  onChange={(e) =>
                    setPicked((p) =>
                      e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id),
                    )
                  }
                />
              ) : null}
              <IdTag>{c.claimId}</IdTag>
              <b className="small">{claimTypeLabel(c.type)}</b>
            </label>
            <p className="small" style={{ marginTop: 4 }}>
              “{c.declaredValue}”
            </p>
            {c.disputes.length > 0 ? (
              <div style={{ marginTop: 6 }}>
                <Chip tone="warn">
                  Disputed by {plural(c.disputes.length, "party", "parties")}
                </Chip>
              </div>
            ) : null}
          </div>
        ))}
      </div>
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
          <ErrorNotice error={error} />
          <div className="row" style={{ flexWrap: "wrap" }}>
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
          <p className="fine" style={{ marginTop: 10 }}>
            A dispute is your recorded assertion, not a fact. It gives your
            evidence against these claims its standing, and the panel is told
            exactly that.
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

  const stageAct = acts.find((a) => a.id === STAGE_ACT[detail.state]);
  return (
    <div className="card card-tight">
      <h3 style={{ marginBottom: 10 }}>Next step</h3>
      {!stageAct ? (
        <p className="muted small">
          The panel is judging the record. Nothing here needs you.
        </p>
      ) : stageAct.available ? (
        <button
          className="btn btn-primary"
          style={{ width: "100%" }}
          disabled={busy !== null}
          onClick={() => run(stageAct)}
        >
          {busy === stageAct.id ? <Spinner /> : stageAct.label}
        </button>
      ) : (
        <p className="act-blocked">
          <b>{stageAct.label}</b>
          <span>{sentence(stageAct.reason)}</span>
        </p>
      )}
      <ErrorNotice error={error} />
      {detail.onChainId && detail.state !== "DRAFT" ? (
        <>
          <div className="divider" />
          <Link className="link small" href={`/assessments/${detail.id}/receipt`}>
            Intake receipt: is my evidence in the judged record? →
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
      <p className="fine">
        A signed link that expires after 14 days, and that you can revoke
        in Settings. It controls the app&apos;s copy only; anything
        adjudicated is already public on the chain.
      </p>
      <ErrorNotice error={error} />
      {token ? (
        <div style={{ marginTop: 10 }}>
          <CopyText
            value={`${window.location.origin}/share/${token}`}
            short={`${window.location.origin.replace(/^https?:\/\//, "")}/share/${token.slice(0, 8)}…`}
          />
          <p className="fine" style={{ marginTop: 6 }}>
            Copy it now: the full link is shown only once.
          </p>
        </div>
      ) : (
        <button
          className="btn btn-ghost"
          style={{ marginTop: 12 }}
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

function SealFailedCard({ job }: { job: JobRow }) {
  return (
    <div className="card">
      <h3>The packet could not be sealed</h3>
      {job.lastError ? (
        <p className="notice notice-bad" style={{ marginTop: 10 }}>
          {failureText(job.lastError)}
        </p>
      ) : null}
      <p className="muted small" style={{ marginTop: 10 }}>
        Nothing was judged: a packet that is not sealed never reaches the
        panel. Whatever did land stays on the chain as it is.
      </p>
    </div>
  );
}

function ProcessingCard({ detail, progress }: { detail: Detail; progress?: string }) {
  return (
    <div className="card">
      <div className="row">
        <Spinner />
        <h3>
          {detail.state === "SUBMITTED"
            ? "The packet is going on chain"
            : "The panel is judging the record"}
        </h3>
        {progress ? <span className="fine" style={{ marginLeft: "auto" }}>{progress}</span> : null}
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
          {failureText(last.errorText)}
        </p>
      ) : null}
      <p className="muted small" style={{ marginTop: 10 }}>
        Nothing was recorded, so the prior record stands. A retry is a new
        attempt with its own transaction.
      </p>
      <AttemptsFeed detail={detail} />
    </div>
  );
}

function AttemptsFeed({ detail }: { detail: Detail }) {
  if (detail.runs.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 10, marginTop: 14 }}>
      {detail.runs.map((r, i) => (
        <div key={i}>
          <div className="row small" style={{ flexWrap: "wrap", gap: 8 }}>
            <Chip
              tone={
                r.status === "SUCCESS" ? "ok" : r.status === "REJECTED" ? "dim" : "bad"
              }
            >
              {attemptLabel(r.kind, r.status)}
            </Chip>
            {r.txHash ? (
              <a
                className="tag"
                href={`${EXPLORER}/tx/${r.txHash}`}
                target="_blank"
                rel="noreferrer"
                title={r.txHash}
              >
                View transaction ↗
              </a>
            ) : null}
          </div>
          {r.errorText ? (
            <p className="fine" style={{ marginTop: 4 }}>
              {failureText(r.errorText)}
            </p>
          ) : null}
        </div>
      ))}
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
  const successRuns = detail.runs.filter((r) => r.status === "SUCCESS").length;
  // Appeal evidence only matters while an appeal is still possible.
  const canAdd =
    detail.state === "DRAFT" ||
    (detail.state === "ADJUDICATED" && !runsExhausted(detail, successRuns));
  return (
    <>
      <div className="spread" style={{ marginTop: 4 }}>
        <h3 style={{ fontSize: 22 }}>The record</h3>
        <span className="muted small">
          {plural(detail.evidenceItems.length, "item")}
        </span>
      </div>
      {detail.evidenceItems.length === 0 ? (
        <Empty>
          The record is empty. Upload the paperwork that backs or contests the
          claims: invoices, history reports, scanner reports, photos. Every
          file is fingerprinted the moment it arrives.
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
      {canAdd && detail.state === "DRAFT" ? (
        <AnchorCard detail={detail} onChange={onChange} />
      ) : null}
    </>
  );
}

function sourceHost(url: string | null): string {
  try {
    return url ? new URL(url).hostname : "";
  } catch {
    return "";
  }
}

function AnchorStatus({ status }: { status: string }) {
  if (status === "PENDING_ENTRY")
    return <Chip tone="signal">Validators are fetching it</Chip>;
  if (status === "SOURCE_UNAVAILABLE")
    return <Chip tone="dim">Validators could not agree on it; never judged</Chip>;
  return <Chip tone="ok">Fetched and hash-agreed by every validator</Chip>;
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
  const anchor = item.lane === "ANCHOR";
  const editable = !anchor && mine && !item.consentedAt && detail.state === "DRAFT";
  const editableAppeal =
    !anchor && mine && !item.consentedAt && detail.state === "ADJUDICATED";
  const who = mine
    ? "you"
    : item.uploaderRole === "BUYER"
      ? "the buyer"
      : "the seller";

  return (
    <div className="card card-tight">
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <IdTag>{item.evidenceId}</IdTag>
        <b className="small">{evidenceClassLabel(item.declaredClass)}</b>
        {item.declaredLabel ? (
          <span className="muted small">“{item.declaredLabel}”</span>
        ) : null}
      </div>

      <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        <span className="tag">
          {anchor ? `Added by ${who}` : `Uploaded by ${who}`}
        </span>
        {anchor ? (
          <>
            {sourceHost(item.anchorUrl) ? (
              <span className="tag" title={item.anchorUrl ?? ""}>
                From {sourceHost(item.anchorUrl)}
              </span>
            ) : null}
            <AnchorStatus status={item.status} />
          </>
        ) : null}
        {!anchor && item.status === "UNEXTRACTED" ? (
          <Chip tone="dim">Stored, text not extracted</Chip>
        ) : null}
        {item.redactionStatus === "REDACTED" ? <Chip tone="info">Redacted</Chip> : null}
        {anchor ? null : item.consentedAt ? (
          <Chip tone="ok">Consented</Chip>
        ) : (
          <Chip tone="warn">Consent pending</Chip>
        )}
        {item.onChainTxHash ? (
          <a
            className="tag"
            href={`${EXPLORER}/tx/${item.onChainTxHash}`}
            target="_blank"
            rel="noreferrer"
            title={`On chain · transaction ${item.onChainTxHash}`}
          >
            On chain ↗
          </a>
        ) : null}
      </div>

      <div className="row actions-row" style={{ marginTop: 8, flexWrap: "wrap", gap: 4 }}>
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
        item.extraction?.status === "EXTRACTED" ? (
          <pre className="evidence-text">{item.extraction.normalizedText}</pre>
        ) : (
          <p className="notice notice-dim" style={{ marginTop: 12 }}>
            This file is stored, but its text could not be extracted. Its
            content is unknown to the record, and the panel is told so.
          </p>
        )
      ) : null}

      {item.observations.length > 0 ? (
        <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 6 }}>
          {item.observations.map((o, i) => (
            <span key={i} className="tag" title={o.sourceField || undefined}>
              {o.diagnosticCode
                ? `Trouble code ${o.diagnosticCode}`
                : `${formatDocDate(o.docDate)} · ${formatOdometer(o.odometerReading, o.odometerUnit)}`}
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

  const excerpt = (s: { start: number; end: number }) => {
    const t = text.slice(s.start, s.end).replace(/\s+/g, " ").trim();
    return t.length > 36 ? `${t.slice(0, 34)}…` : t;
  };

  return (
    <div className="panel">
      <p className="muted small">
        Select the passage to remove, then add it. Redaction re-fingerprints
        the item; it must happen before consent and is impossible after
        submission.
      </p>
      <textarea
        readOnly
        rows={7}
        className="mono"
        aria-label="Evidence text to redact"
        style={{ marginTop: 10, fontSize: 12.5 }}
        value={text}
        onSelect={(e) => {
          const el = e.target as HTMLTextAreaElement;
          setSelStart(el.selectionStart);
          setSelEnd(el.selectionEnd);
        }}
      />
      <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 6 }}>
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
          <span key={i} className="tag redaction-span">
            “{excerpt(s)}”
            <button
              type="button"
              className="tag-remove"
              aria-label="Remove this span"
              onClick={() => setSpans((all) => all.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <ErrorNotice error={error} />
      <button
        className="btn btn-primary"
        style={{ marginTop: 12 }}
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
        {busy ? (
          <Spinner />
        ) : spans.length === 1 ? (
          "Apply 1 redaction"
        ) : (
          `Apply ${spans.length} redactions`
        )}
      </button>
    </div>
  );
}

const EMPTY_ROW = {
  docDate: "",
  odometerReading: "",
  odometerUnit: "MILES",
  diagnosticCode: "",
  sourceField: "",
};

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
      : [{ ...EMPTY_ROW }],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (i: number, patch: Partial<typeof EMPTY_ROW>) =>
    setRows((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="panel">
      <p className="muted small">
        The readings you type here are what the contract checks mileage
        against; a reading that appears only in free text can never raise a
        mileage flag. Trouble codes are normalized in code, and what a code
        means stays with the panel.
      </p>
      <div className="stack" style={{ gap: 8, marginTop: 12 }}>
        {rows.map((r, i) => (
          <div key={i} className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <input
              type="date"
              aria-label="Date on the document"
              style={{ width: 160 }}
              value={r.docDate}
              onChange={(e) => set(i, { docDate: e.target.value })}
            />
            <input
              type="number"
              placeholder="Odometer"
              aria-label="Odometer reading"
              style={{ width: 130 }}
              value={r.odometerReading}
              onChange={(e) => set(i, { odometerReading: e.target.value })}
            />
            <select
              aria-label="Unit"
              style={{ width: 80 }}
              value={r.odometerUnit}
              onChange={(e) => set(i, { odometerUnit: e.target.value })}
            >
              <option value="MILES">mi</option>
              <option value="KM">km</option>
            </select>
            <input
              type="text"
              placeholder="Trouble code"
              aria-label="Trouble code, for example P0301"
              title="For example P0301"
              className="mono-input"
              style={{ width: 130 }}
              value={r.diagnosticCode}
              onChange={(e) => set(i, { diagnosticCode: e.target.value.toUpperCase() })}
            />
            <input
              type="text"
              placeholder="Where in the document"
              aria-label="Where in the document"
              style={{ flex: 1, minWidth: 160 }}
              value={r.sourceField}
              onChange={(e) => set(i, { sourceField: e.target.value })}
            />
            <button
              className="btn btn-quiet"
              disabled={rows.length <= 1}
              aria-label="Remove this reading"
              title="Remove this reading"
              onClick={() => setRows((all) => all.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
        <button
          className="btn btn-quiet"
          disabled={rows.length >= 12}
          onClick={() => setRows((all) => [...all, { ...EMPTY_ROW }])}
        >
          Add a reading
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
          {busy ? <Spinner /> : "Save readings"}
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
    <div className="panel panel-signal">
      <p className="small" style={{ fontWeight: 600 }}>
        {PUBLICITY_STATEMENT}
      </p>
      <label className="row small" style={{ marginTop: 12, cursor: "pointer", gap: 10 }}>
        <input
          type="checkbox"
          checked={acked}
          onChange={(e) => setAcked(e.target.checked)}
        />
        I understand that once this item is adjudicated, its text is public
        forever.
      </label>
      <ErrorNotice error={error} />
      <button
        className="btn btn-primary"
        style={{ marginTop: 12 }}
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
        {busy ? <Spinner /> : `Consent to publish ${item.evidenceId}`}
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
  // Ask SILENTLY first. eth_accounts returns the already-permitted
  // account without a popup; only fall back to eth_requestAccounts when
  // the wallet genuinely has not authorised this site yet. Asking
  // unconditionally is what makes an app feel like it keeps demanding
  // you reconnect.
  let address: string | undefined;
  try {
    const known = (await provider.request({ method: "eth_accounts" })) as string[];
    address = known?.[0];
  } catch {
    address = undefined;
  }
  if (!address) {
    const accounts = (await provider.request({
      method: "eth_requestAccounts",
    })) as string[];
    address = accounts?.[0];
  }
  if (!address) return "";
  return (await provider.request({
    method: "personal_sign",
    params: [attestationMessage(opts), address],
  })) as string;
}

/**
 * The independent-source lane — the only evidence the CONTRACT fetches,
 * and the only path to VERIFIED. It lived in scripts until now, which
 * meant the strongest verdict in the system was unreachable by anyone
 * actually using the product.
 */
function AnchorCard({
  detail,
  onChange,
}: {
  detail: Detail;
  onChange: () => void;
}) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [allowlist, setAllowlist] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<{ config: { anchor_allowlist?: string[] } }>("/api/config")
      .then((c) => setAllowlist(c.config.anchor_allowlist ?? []))
      .catch(() => setAllowlist([]));
  }, []);

  return (
    <div className="card card-dashed">
      <h3>Add an independent source</h3>
      <p className="muted small" style={{ marginTop: 6 }}>
        Unlike a document you upload, this one is fetched by{" "}
        <strong>every validator itself</strong>, and it only enters the record
        if they all agree on its contents. It is the only evidence neither
        party can author, and the only way a claim can be verified.
      </p>
      {allowlist !== null && allowlist.length === 0 ? (
        <div className="notice notice-warn" style={{ marginTop: 12 }}>
          This deployment allows no independent sources, so no claim can be
          verified here. That is a deployment choice, and the report says so
          rather than pretending otherwise.
        </div>
      ) : (
        <>
          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="anchor-url">Source address</label>
            <input
              id="anchor-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://raw.githubusercontent.com/…/registry-extract.txt"
            />
            {allowlist ? (
              <span className="hint">
                Accepted sources: {allowlist.join(", ")}
              </span>
            ) : null}
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
            We read it once now to commit an expected fingerprint. If what the
            validators fetch differs, the item is recorded as unavailable and
            never judged, and you will see that on the record.
          </p>
          <ErrorNotice error={error} />
          <button
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            disabled={busy || !url.startsWith("https://")}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api(`/api/assessments/${detail.id}/anchor`, {
                  method: "POST",
                  body: JSON.stringify({ url, declaredLabel: label }),
                });
                setUrl("");
                setLabel("");
                onChange();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner /> : "Send it to the validators"}
          </button>
        </>
      )}
    </div>
  );
}

function UploadCard({
  detail,
  onChange,
}: {
  detail: Detail;
  onChange: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [declaredClass, setDeclaredClass] = useState("SERVICE_INVOICE");
  const [label, setLabel] = useState("");
  const [captureDate, setCaptureDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  return (
    <div className="card card-dashed">
      <h3 style={{ marginBottom: 6 }}>
        {detail.state === "ADJUDICATED" ? "Add appeal evidence" : "Add evidence"}
      </h3>
      <p className="fine">
        The document type is <em>your</em> label: the panel decides from the
        content what the document actually is, and a wrong label counts
        against the side that chose it. Files are identified by their
        contents, never their extension.
      </p>
      <div className="form-grid" style={{ marginTop: 14 }}>
        <div className="field" style={{ marginBottom: 8 }}>
          <label htmlFor="upload-file">File</label>
          <input
            key={inputKey}
            id="upload-file"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="field" style={{ marginBottom: 8 }}>
          <label htmlFor="upload-class">Document type</label>
          <select
            id="upload-class"
            value={declaredClass}
            onChange={(e) => setDeclaredClass(e.target.value)}
          >
            {UPLOAD_CLASSES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 8 }}>
          <label htmlFor="upload-label">Label (optional)</label>
          <input
            id="upload-label"
            type="text"
            maxLength={80}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="March service invoice"
          />
        </div>
        <div className="field" style={{ marginBottom: 8 }}>
          <label htmlFor="upload-date">Document date</label>
          <input
            id="upload-date"
            type="date"
            value={captureDate}
            onChange={(e) => setCaptureDate(e.target.value)}
          />
        </div>
      </div>
      <ErrorNotice error={error} />
      <button
        className="btn btn-primary"
        style={{ marginTop: 6 }}
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
            setInputKey((k) => k + 1);
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
