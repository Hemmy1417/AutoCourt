/**
 * The shapes the contract's views return, read from
 * contracts/autocourt_assessment.py rather than guessed. Every view returns
 * canonical JSON; lib/read.ts parses it into these.
 */

/** OPEN takes evidence, SEALED waits for the panel, ADJUDICATED has a verdict. */
export type RecordState = "OPEN" | "SEALED" | "ADJUDICATED";

export type IdentityStatus = "CONFIRMED" | "MISMATCH" | "UNDECODABLE" | "SOURCE_UNAVAILABLE";

export interface Claim {
  claim_id: string;
  type: string;
  declared_value: string;
}

/** An item as get_assessment lists it: everything except the judged text. */
export interface ItemSummary {
  evidence_id: string;
  lane: "UPLOADED" | "ANCHOR";
  /** SUBMISSION before the seal; APPEAL for post-verdict items. */
  phase: "SUBMISSION" | "APPEAL";
  status: "EXTRACTED" | "UNEXTRACTED" | "SOURCE_UNAVAILABLE";
  declared_class: string;
  declared_label: string;
  /** Lowercase account; "" for an independent source, which no party supplied. */
  uploader_account: string;
  uploader_role: "SELLER" | "BUYER" | "";
  file_sha256: string;
  text_sha256: string;
  extractor_version: string;
  uploader_signature?: string;
  /** For APPEAL items: 0 until an appeal round judges it. */
  judged_version?: number | null;
  /** Independent sources only: the wallet that asked the validators to fetch it. */
  added_by?: string | null;
}

export interface Observation {
  evidence_id: string;
  uploader_account: string;
  doc_date: string;
  source_field: string;
  odometer_reading?: number;
  odometer_unit?: "MILES" | "KM";
}

/** get_item_text: the full stored item, text included. */
export interface ItemRecord extends ItemSummary {
  text: string;
  observations: Observation[];
  diagnostic_codes: string[];
  capture_date: string;
  /** Independent sources only. */
  url?: string;
}

export interface Dispute {
  account: string;
  claim_ids: string[];
  note: string;
  /** How many runs the record held when the dispute was entered. */
  after_runs: number;
  /** The transaction's actual sender. */
  address: string;
}

export interface RecordView {
  assessment_id: string;
  state: RecordState;
  vin: string;
  vin_check_digit_ok: boolean;
  identity_status: IdentityStatus;
  registry_source: string;
  registry_fields: Record<string, string>;
  make: string;
  model: string;
  year: number;
  /** Lowercase account named as the seller of record. */
  seller_account: string;
  /** The address that actually sent create_assessment. */
  seller_address: string;
  claims: Claim[];
  packet_version: number;
  runs_count: number;
  items: ItemSummary[];
  disputes: Dispute[];
}

export interface ClaimResult {
  claim_id: string;
  claim_type: string;
  verdict: string;
  adverse: boolean;
  confidence: string;
  next_action: string;
  support_classes: string[];
  contradict_classes: string[];
}

export interface VerdictView {
  assessment_id: string;
  standing_run: number;
  total_runs: number;
  rollup: string | null;
  inspection_required?: boolean;
  flags?: Record<string, boolean>;
  claims?: ClaimResult[];
  unresolved_questions?: Record<string, string>;
  ruleset?: string;
}

export interface Finding {
  claim_id?: string;
  evidence_id: string;
  status: "SUPPORTED" | "CONTRADICTED" | "ABSENT";
  severity: string;
  quotes: { evidence_id: string; text: string }[];
}

export interface RunView {
  run: number;
  status: "SUCCESS";
  packet_version: number;
  kind: "ADJUDICATION" | "RE_ADJUDICATION";
  appellant: string;
  prior_run: number;
  report: {
    rollup: string;
    inspection_required: boolean;
    flags: Record<string, boolean>;
    claims: ClaimResult[];
    ruleset: string;
  };
  findings: Record<string, Finding[]>;
  sufficiency: Record<string, string>;
  unresolved_questions: Record<string, string>;
}

export interface ManifestView {
  version: number;
  root: string;
  /** [evidence_id, file_sha256, text_sha256, extractor_version], sorted. */
  entries: string[][];
}

export interface ChainConfig {
  ruleset: string;
  max_claims: number;
  max_items_at_submission: number;
  max_new_items_per_appeal: number;
  max_seller_items_at_submission: number;
  max_other_items_at_submission: number;
  max_seller_items_per_appeal: number;
  max_other_items_per_appeal: number;
  writes_bound_to_signer: boolean;
  max_evidence_items: number;
  per_item_text_cap: number;
  max_runs_per_assessment: number;
  note_cap: number;
  max_grounds_chars: number;
  max_obs_rows_per_item: number;
  max_diag_codes_per_item: number;
  max_disputing_accounts: number;
  anchor_fetch_cap: number;
  anchor_allowlist: string[];
  identity_registry: string;
  verified_reachable: boolean;
}
