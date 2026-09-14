/**
 * What goes on the record, built in the browser: an uploaded item's write
 * payload, the next evidence id, and the manifest root the seal must name.
 *
 * The manifest root here MUST equal the contract's `_manifest_root`
 * byte for byte; tests/packet.test.ts pins it against a golden computed in
 * Python. The contract recomputes it over the items it already stores and
 * refuses a seal whose root differs, so this copy is a cross-check the
 * contract enforces, never a source of truth.
 */
import { sha256Text } from "./evidence/hash";

export interface ManifestEntry {
  evidenceId: string;
  fileSha256: string;
  textSha256: string;
  extractorVersion: string;
}

/** Python's sort of lists of strings: element by element, by code point. */
function compareTuples(a: string[], b: string[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? "";
    const y = b[i] ?? "";
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** Mirrors the contract: sha256 over canonical JSON of the sorted 4-tuples. */
export async function manifestRoot(entries: ManifestEntry[]): Promise<string> {
  const tuples = entries
    .map((e) => [e.evidenceId, e.fileSha256, e.textSha256, e.extractorVersion])
    .sort(compareTuples);
  // json.dumps(..., sort_keys=True, separators=(",", ":")) on a list of
  // ASCII string lists is exactly JSON.stringify on the same shape.
  return sha256Text(JSON.stringify(tuples));
}

/**
 * The next free evidence id. The contract refuses a duplicate id, so a race
 * with another party adding an item at the same moment fails in the fee
 * simulation, before anything is signed, and the retry takes the next one.
 */
export function nextEvidenceId(existing: { evidence_id: string }[]): string {
  const taken = new Set(existing.map((i) => i.evidence_id));
  let n = existing.length + 1;
  while (taken.has(`E-${String(n).padStart(3, "0")}`)) n++;
  return `E-${String(n).padStart(3, "0")}`;
}

export interface ObservationRow {
  doc_date: string;
  odometer_reading?: number;
  odometer_unit?: "MILES" | "KM";
  source_field: string;
}

export interface UploadedItemPayload {
  evidence_id: string;
  declared_class: string;
  declared_label: string;
  uploader_account: string;
  uploader_role: "SELLER" | "BUYER";
  file_sha256: string;
  text_sha256: string;
  extractor_version: string;
  status: "EXTRACTED" | "UNEXTRACTED";
  text: string;
  uploader_signature: string;
  observations: ObservationRow[];
  diagnostic_codes: string[];
  capture_date: string;
}

/** One submit_evidence_text / submit_appeal_evidence argument. */
export function uploadedItemJson(p: UploadedItemPayload): string {
  return JSON.stringify({ ...p, text: p.status === "EXTRACTED" ? p.text : "" });
}

/** One submit_anchor_item argument. */
export function anchorItemJson(p: {
  evidence_id: string;
  declared_label: string;
  url: string;
  expected_sha256: string;
}): string {
  return JSON.stringify({ ...p, declared_class: "EXTERNAL_SOURCE_RESULT" });
}
