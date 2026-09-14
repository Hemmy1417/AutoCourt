/**
 * How the record's vocabulary reads on screen — the ONE place it is decided.
 *
 * The contract and the database speak in identifiers (PARTIALLY_VERIFIED,
 * FIRST_PARTY, ac-000021). People should never have to. Every value that
 * reaches a screen passes through here, and every lookup has a fallback
 * that still reads as words, so a value added later can never surface as
 * a raw constant. Pure: safe on the server and in the browser.
 */

/** "PARTIALLY_VERIFIED" → "Partially verified" — the fallback for any value. */
export function humanize(value: string | null | undefined): string {
  if (!value) return "";
  const words = value.replace(/_/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function lookup(map: Record<string, string>, value: string | null | undefined) {
  if (!value) return "";
  return map[value] ?? humanize(value);
}

/** Capitalized, and ending in punctuation: API messages read as sentences. */
export function sentence(text: string | null | undefined): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  const capped = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?…)]$/.test(capped) ? capped : `${capped}.`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/* ── record lifecycle ─────────────────────────────────────────────────── */

const STATE: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  PROCESSING: "In review",
  ADJUDICATED: "Adjudicated",
  FAILED: "Attempt failed",
};
export const stateLabel = (s: string) => lookup(STATE, s);

/** For the middle of a sentence: "this record is <phrase>". */
const STATE_PHRASE: Record<string, string> = {
  DRAFT: "still a draft",
  SUBMITTED: "submitted and waiting for the panel",
  PROCESSING: "being adjudicated right now",
  ADJUDICATED: "already adjudicated",
  FAILED: "waiting for a retry",
};
export const statePhrase = (s: string) =>
  STATE_PHRASE[s] ?? humanize(s).toLowerCase();

/* ── claims and verdicts ──────────────────────────────────────────────── */

export const CLAIM_TYPES: { value: string; label: string; example: string }[] = [
  { value: "MILEAGE", label: "Mileage", example: "87,432 miles" },
  { value: "ACCIDENT_HISTORY", label: "Accident history", example: "No recorded accidents" },
  { value: "CONDITION", label: "Condition", example: "Excellent; no rust; original paint" },
  { value: "DEFECT_DISCLOSURE", label: "Defect disclosure", example: "Minor oil seep at the valve cover, disclosed" },
  { value: "SERVICE_HISTORY", label: "Service history", example: "Full history at a main dealer" },
];
export const claimTypeLabel = (t: string) =>
  lookup(Object.fromEntries(CLAIM_TYPES.map((c) => [c.value, c.label])), t);

/** Claim verdicts and assessment headlines share one vocabulary. */
const VERDICT: Record<string, string> = {
  VERIFIED: "Verified",
  PARTIALLY_VERIFIED: "Partially verified",
  CLAIM_CONTRADICTED: "Contradicted",
  CONFLICTING_EVIDENCE: "Conflicting evidence",
  INSUFFICIENT_EVIDENCE: "Insufficient evidence",
  PHYSICAL_INSPECTION_REQUIRED: "Inspection required",
  INCONCLUSIVE: "Inconclusive",
  MATERIAL_CONCERN: "Material concern",
  MILEAGE_CONFLICT: "Mileage conflict",
  POSSIBLE_ODOMETER_ROLLBACK: "Possible odometer rollback",
  DIAGNOSTIC_CONCERN_SUPPORTED: "Diagnostic concern",
  SOURCE_UNAVAILABLE: "Source unavailable",
};
export const verdictLabel = (v: string) => lookup(VERDICT, v);

/** The code flags a report can raise, each with its own name. */
export const FLAGS: { key: string; label: string; tone: "warn" | "bad" }[] = [
  { key: "odometer_rollback_indicated", label: "Possible odometer rollback", tone: "bad" },
  { key: "mileage_conflict", label: "Mileage conflict", tone: "warn" },
  { key: "vehicle_identity_mismatch", label: "Vehicle identity mismatch", tone: "bad" },
  { key: "diagnostic_concern_supported", label: "Diagnostic concern", tone: "warn" },
];

const CONFIDENCE: Record<string, string> = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" };
export const confidenceLabel = (c: string) => lookup(CONFIDENCE, c);

export const NEXT_ACTION: Record<string, string> = {
  NONE: "No action needed.",
  OBTAIN_INDEPENDENT_RECORD:
    "Obtain an independent record, such as a registry extract or a third-party history, to lift this claim.",
  RAISE_WITH_SELLER: "Raise the contradiction with the seller before going further.",
  REQUEST_DOCUMENTATION: "Request the missing documentation from the seller.",
  BOOK_MECHANICAL_INSPECTION: "Book a physical mechanical inspection before purchase.",
  RECONCILE_VEHICLE_IDENTITY:
    "Reconcile the vehicle's identity first: the VIN does not decode to the vehicle listed.",
};
export const nextActionText = (a: string) => NEXT_ACTION[a] ?? sentence(humanize(a));

/**
 * Where a claim's support or contradiction comes from. The contract derives
 * the class per piece of evidence and direction; the names describe the
 * uploader's interest, which is what the class actually measures.
 */
const CORROBORATION: Record<string, { label: string; detail: string }> = {
  INDEPENDENT: {
    label: "Independent source",
    detail: "Fetched and hash-agreed by every validator from a source neither party controls.",
  },
  ADVERSE: {
    label: "Against its uploader's interest",
    detail: "Evidence that works against the side that supplied it — the most credible kind a party can give.",
  },
  FIRST_PARTY: {
    label: "Interested party",
    detail: "Evidence from the side it favours. It counts, but it can never verify a claim on its own.",
  },
};
export const corroborationLabel = (c: string) => CORROBORATION[c]?.label ?? humanize(c);
export const corroborationDetail = (c: string) => CORROBORATION[c]?.detail ?? "";

const SUFFICIENCY: Record<string, string> = {
  SUFFICIENT: "The record is sufficient to decide this claim",
  PARTIAL: "The record only partly covers this claim",
  INSUFFICIENT: "The record is not sufficient to decide this claim",
};
export const sufficiencyText = (s: string) => lookup(SUFFICIENCY, s);

const SEVERITY: Record<string, string> = {
  MINOR: "Minor",
  MODERATE: "Moderate",
  MAJOR: "Major",
  SAFETY_CRITICAL: "Safety-critical",
};
export const severityLabel = (s: string) => lookup(SEVERITY, s);

/* ── identity check ───────────────────────────────────────────────────── */

const IDENTITY: Record<string, string> = {
  CONFIRMED: "Confirmed",
  MISMATCH: "Mismatch",
  UNDECODABLE: "Could not be decoded",
  SOURCE_UNAVAILABLE: "Registry unavailable",
};
export const identityLabel = (s: string) => lookup(IDENTITY, s);

/** Makes that are written as initials; everything else reads in title case. */
const INITIALISMS = new Set(["BMW", "GMC", "MG", "RAM", "BYD", "DAF", "MAN", "VW", "KTM", "AMC", "DS", "SEAT", "MINI"]);

/**
 * The federal registry answers in capitals ("HONDA", "MOTOR COACH
 * INDUSTRIES"). Shown as-is, a registry fact looks like a machine dump.
 */
export function registryName(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v || v !== v.toUpperCase()) return v; // already mixed case: the registry's own spelling
  return v
    .split(/(\s+|-|\/)/)
    .map((w) =>
      // Initialisms stay as written, and so do model codes ("102C3", "X5").
      INITIALISMS.has(w) || /\d/.test(w)
        ? w
        : w.charAt(0) + w.slice(1).toLowerCase(),
    )
    .join("");
}

/* ── evidence ─────────────────────────────────────────────────────────── */

export const EVIDENCE_CLASSES: { value: string; label: string }[] = [
  { value: "SERVICE_INVOICE", label: "Service invoice" },
  { value: "VEHICLE_HISTORY_RECORD", label: "Vehicle history record" },
  { value: "MECHANIC_REPORT", label: "Mechanic's report" },
  { value: "DIAGNOSTIC_SCANNER_REPORT", label: "Diagnostic scanner report" },
  { value: "GOVERNMENT_IMPORT_INSPECTION_DOCUMENT", label: "Government import inspection" },
  { value: "SELLER_DECLARATION", label: "Seller's declaration" },
  { value: "BUYER_DECLARATION", label: "Buyer's declaration" },
  { value: "MANUAL_OBSERVATION", label: "Manual observation" },
  { value: "IMAGE", label: "Photo" },
  { value: "VIDEO", label: "Video" },
  { value: "OCR_EXTRACTED_TEXT", label: "OCR-extracted text" },
  { value: "EXTERNAL_SOURCE_RESULT", label: "Independent source" },
];
export const evidenceClassLabel = (c: string) =>
  lookup(Object.fromEntries(EVIDENCE_CLASSES.map((e) => [e.value, e.label])), c);

const ROLE: Record<string, string> = { SELLER: "Seller", BUYER: "Buyer" };
export const roleLabel = (r: string) => lookup(ROLE, r);

/* ── runs and attempts ────────────────────────────────────────────────── */

export function attemptLabel(kind: string, status: string): string {
  const what = kind === "RE_ADJUDICATION" ? "Appeal" : "Adjudication";
  if (status === "SUCCESS") return `${what} · verdict recorded`;
  if (status === "REJECTED") return `${what} · refused by the contract`;
  return `${what} · did not complete`;
}

const STEP: Record<string, string> = {
  CREATE: "opening the record",
  SUBMIT_EVIDENCE: "entering the evidence",
  SUBMIT_ANCHOR: "entering the independent source",
  RECORD_DISPUTE: "recording the dispute",
  SEAL: "sealing the packet",
  SUBMIT_APPEAL_EVIDENCE: "entering the appeal evidence",
  ADJUDICATE: "the adjudication",
  READJUDICATE: "the appeal",
};

/**
 * Why an attempt failed, in words. Contract refusals keep their sentence —
 * the contract's reason IS the record — minus the machine tag in front;
 * the queue's own shorthand is translated.
 */
export function failureText(raw: string | null | undefined): string {
  let t = (raw ?? "").trim();
  if (!t) return "";
  t = t.replace(/\s*\(attempt \d+, tx 0x[0-9a-fA-F]+\)\s*$/, "");
  const earlier = t.match(/^an earlier step failed \(([A-Z_]+)\)/)?.[1];
  if (earlier) {
    return `An earlier step — ${STEP[earlier] ?? "a previous write"} — failed, so this attempt never ran.`;
  }
  if (/^UNDETERMINED/.test(t)) return "The validators could not reach agreement, so no verdict was recorded.";
  if (/^CANCELED/.test(t)) return "The transaction was cancelled before it completed.";
  if (/leader=ERROR|^FINALIZED leader=/.test(t)) return "The panel could not produce a valid result, so nothing was recorded.";
  if (/^polling:|fetch failed|ECONNRESET|ETIMEDOUT/i.test(t)) return "The network connection to the chain failed; the attempt will be retried.";
  t = t
    .replace(/^\[[A-Z_]+\]\s*/, "")
    // A trailing "(readjudicate)" names a contract function, not a reason.
    .replace(/\s*\((?:[a-z]+_)*[a-z]+\)\s*$/, "");
  return sentence(t);
}

/* ── formats ──────────────────────────────────────────────────────────── */

/*
 * Dates are spelled out by hand rather than by Intl: browsers disagree on
 * abbreviations ("Sep" in one engine, "Sept" in another), and a record
 * should read the same wherever it is opened.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A moment (ISO timestamp), in the viewer's time: "14 Sep 2026". */
export function formatDate(iso: string | null | undefined): string {
  const d = parse(iso);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : "";
}

/** "14 Sep 2026, 13:23" — 24-hour, in the viewer's time. */
export function formatDateTime(iso: string | null | undefined): string {
  const d = parse(iso);
  return d ? `${formatDate(iso)}, ${two(d.getHours())}:${two(d.getMinutes())}` : "";
}

/**
 * A document's own date ("2026-03-11"). It has no time or zone, so it is
 * formatted as written — never shifted a day by the viewer's timezone.
 */
export function formatDocDate(ymd: string | null | undefined): string {
  const m = (ymd ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd ?? "";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""} ${m[1]}`;
}

export function formatOdometer(reading: number | null | undefined, unit: string | null | undefined): string {
  if (reading === null || reading === undefined) return "";
  return `${reading.toLocaleString("en-US")} ${unit === "KM" ? "km" : "mi"}`;
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} bytes`;
}

/** "ac-000021" → "Record #21". The exact id stays in the verification views. */
export function recordNumber(onChainId: string | null | undefined): string {
  const m = (onChainId ?? "").match(/^ac-0*(\d+)$/);
  return m ? `Record #${m[1]}` : "";
}

export function vehicleTitle(v: { year: number; make: string; model: string }): string {
  return `${v.year} ${v.make} ${v.model}`;
}
