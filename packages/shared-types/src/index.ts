/**
 * The shared verdict vocabulary, mirrored by the contract; the app never
 * invents a value. The brief's 13 verdict values are all here, but they are
 * FOUR different kinds of thing (design review, blocking finding: a flat
 * enum let one deterministic function contradict itself, and a name-keyed
 * floor let POSSIBLE_ODOMETER_ROLLBACK slip past the corroboration floor
 * that blocked only CLAIM_CONTRADICTED). Floors and gates key on the
 * `adverse` attribute, never on enumerated names.
 */

/** (a) Claim-level verdicts — exactly one per claim. */
export const CLAIM_VERDICTS = [
  "VERIFIED",
  "PARTIALLY_VERIFIED",
  "CLAIM_CONTRADICTED",
  "CONFLICTING_EVIDENCE",
  "INSUFFICIENT_EVIDENCE",
  "PHYSICAL_INSPECTION_REQUIRED",
  "INCONCLUSIVE",
] as const;
export type ClaimVerdict = (typeof CLAIM_VERDICTS)[number];

/** Direction attribute every floor keys on. Adverse = against the seller's case. */
export const ADVERSE_CLAIM_VERDICTS: readonly ClaimVerdict[] = [
  "CLAIM_CONTRADICTED",
];

/**
 * (b) Code-derived flags — never claim verdicts, recomputed by the contract
 * from typed observation rows plus equivalence-agreed explanation findings.
 * All three are adverse when set.
 */
export const CODE_FLAGS = [
  "mileage_conflict",
  "odometer_rollback_indicated",
  "diagnostic_concern_supported",
] as const;
export type CodeFlag = (typeof CODE_FLAGS)[number];

/**
 * (c) Assessment-level rollup — the report headline, derived by fixed
 * precedence over claim verdicts + flags. Listed in precedence order:
 * the first value whose condition holds is the headline.
 */
export const ASSESSMENT_ROLLUPS = [
  "POSSIBLE_ODOMETER_ROLLBACK", // odometer_rollback_indicated flag
  "MILEAGE_CONFLICT", // mileage_conflict flag (explained or unjudged)
  "MATERIAL_CONCERN", // any adverse claim verdict or SAFETY_CRITICAL finding
  "DIAGNOSTIC_CONCERN_SUPPORTED", // diagnostic_concern_supported flag
  "PHYSICAL_INSPECTION_REQUIRED", // any claim requires inspection
  "CONFLICTING_EVIDENCE", // any claim conflicted, none of the above
  "INSUFFICIENT_EVIDENCE", // any claim insufficient, none of the above
  "VERIFIED", // every claim VERIFIED
  "PARTIALLY_VERIFIED", // every claim at least PARTIALLY_VERIFIED
  "INCONCLUSIVE", // anything else
] as const;
export type AssessmentRollup = (typeof ASSESSMENT_ROLLUPS)[number];

/**
 * (d) Run statuses — never verdicts. The CHAIN records only SUCCESS runs:
 * a structurally invalid panel output never survives consensus, so
 * REJECTED (consensus refused the attempt) and FAILED (transport/transient,
 * retryable) are app-side records of attempts, each kept with its
 * transaction hash.
 */
export const RUN_STATUSES = ["SUCCESS", "REJECTED", "FAILED"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * (d) Item statuses. SOURCE_UNAVAILABLE is reachable only through the
 * independent-anchor lane (all validators agreed the anchor was
 * unreachable or mismatched); for uploaded items the analogue is
 * extraction UNAVAILABLE, disclosed to the panel.
 */
export const ITEM_STATUSES = [
  "EXTRACTED",
  "UNEXTRACTED", // stored, hashed, no text (no OCR, video, etc.)
  "SOURCE_UNAVAILABLE", // anchor lane only
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/**
 * The brief's 13-value enum contract, honored as a mapping into the
 * partition above so every value has exactly one home and a producing
 * path (or an explicit RESERVED note) — the S12 release gate greps this.
 */
export const BRIEF_VERDICT_HOMES: Record<string, string> = {
  VERIFIED: "claim verdict (requires INDEPENDENT corroboration)",
  PARTIALLY_VERIFIED: "claim verdict",
  CLAIM_CONTRADICTED: "claim verdict (adverse; corroboration floor applies)",
  CONFLICTING_EVIDENCE: "claim verdict",
  INSUFFICIENT_EVIDENCE: "claim verdict",
  PHYSICAL_INSPECTION_REQUIRED: "claim verdict",
  INCONCLUSIVE: "claim verdict",
  MATERIAL_CONCERN: "assessment rollup",
  MILEAGE_CONFLICT: "assessment rollup (from mileage_conflict flag)",
  POSSIBLE_ODOMETER_ROLLBACK:
    "assessment rollup (from odometer_rollback_indicated flag)",
  DIAGNOSTIC_CONCERN_SUPPORTED:
    "assessment rollup (from diagnostic_concern_supported flag)",
  SOURCE_UNAVAILABLE: "item status (anchor lane)",
  REJECTED: "run status",
};

/** Claim types the seller declares against (brief §4). */
export const CLAIM_TYPES = [
  "MILEAGE",
  "ACCIDENT_HISTORY",
  "CONDITION",
  "DEFECT_DISCLOSURE",
  "SERVICE_HISTORY",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

/** Panel finding status per (claim, evidence) — inside equivalence. */
export const FINDING_STATUSES = ["SUPPORTED", "CONTRADICTED", "ABSENT"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

/**
 * Explanation finding for a code-detected mileage conflict — inside
 * equivalence; NOT_EXPLAINED promotes the flag to rollback-indicated.
 */
export const EXPLANATION_STATUSES = ["EXPLAINED", "NOT_EXPLAINED"] as const;
export type ExplanationStatus = (typeof EXPLANATION_STATUSES)[number];

/** Severity bands — inside equivalence; SAFETY_CRITICAL always sets the inspection bit. */
export const SEVERITY_BANDS = [
  "MINOR",
  "MODERATE",
  "MAJOR",
  "SAFETY_CRITICAL",
] as const;
export type SeverityBand = (typeof SEVERITY_BANDS)[number];

/**
 * Corroboration ladder — derived IN THE CONTRACT per (claim, item,
 * direction) edge from primitive calldata facts; the app's copy is
 * display-only. Same-account items never corroborate each other;
 * VERIFIED requires INDEPENDENT.
 */
export const CORROBORATION_CLASSES = [
  "INDEPENDENT", // entered through the every-validator anchor lane
  "ADVERSE", // distinct account with a recorded opposing dispute stake
  "FIRST_PARTY", // uploaded by the party the claim favors
] as const;
export type CorroborationClass = (typeof CORROBORATION_CLASSES)[number];

/** Derived in code from agreed inputs — never a panel output. */
export const CONFIDENCE_BANDS = ["LOW", "MEDIUM", "HIGH"] as const;
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];

/** Evidence classes, verbatim from brief §6. The label is the uploader's claim, never fact. */
export const EVIDENCE_CLASSES = [
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
] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

/** How an item's judged bytes entered the record. */
export const ENTRY_LANES = ["UPLOADED", "ANCHOR"] as const;
export type EntryLane = (typeof ENTRY_LANES)[number];

/** Assessment lifecycle (ARCHITECTURE §7). */
export const ASSESSMENT_STATES = [
  "DRAFT",
  "SUBMITTED",
  "PROCESSING",
  "ADJUDICATED",
  "FAILED",
] as const;
export type AssessmentState = (typeof ASSESSMENT_STATES)[number];

/** Share-link lifecycle — wall-clock expiry, never activity-counted. */
export const SHARE_LINK_STATES = ["ACTIVE", "REVOKED", "EXPIRED"] as const;
export type ShareLinkState = (typeof SHARE_LINK_STATES)[number];
