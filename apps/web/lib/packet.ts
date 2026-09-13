/**
 * The packet builder: DB rows in, the contract's exact write payloads
 * out. Pure over plain data so tests need no database, and the manifest
 * root here MUST equal the contract's `_manifest_root` byte-for-byte —
 * a golden test pins the cross-language agreement.
 *
 * The app's copies of derived things (corroboration class previews, code
 * flags) are display-only; nothing computed here is decisive. The
 * contract re-derives everything that matters (S7).
 */

import { createHash } from "node:crypto";

export interface ManifestEntry {
  evidenceId: string;
  fileSha256: string;
  textSha256: string;
  extractorVersion: string;
}

/** Mirrors the contract: sha256 over canonical JSON of sorted 4-tuples. */
export function manifestRoot(entries: ManifestEntry[]): string {
  const tuples = entries.map((e) => [
    e.evidenceId,
    e.fileSha256,
    e.textSha256,
    e.extractorVersion,
  ]);
  tuples.sort((a, b) => {
    for (let i = 0; i < 4; i++) {
      const x = a[i] ?? "";
      const y = b[i] ?? "";
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  });
  // Python json.dumps(..., sort_keys=True, separators=(",", ":")) on a
  // list of string lists === JSON.stringify on the same shape.
  const canonical = JSON.stringify(tuples);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface ObservationRow {
  doc_date: string;
  odometer_reading?: number;
  odometer_unit?: "MILES" | "KM";
  source_field: string;
}

export interface EvidenceWritePayload {
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
  observations: ObservationRow[];
  diagnostic_codes: string[];
  capture_date: string;
}

export interface ItemForPacket {
  evidenceId: string;
  declaredClass: string;
  declaredLabel: string;
  uploaderAccount: string;
  uploaderRole: "SELLER" | "BUYER";
  fileSha256: string;
  /** Post-redaction normalized text; "" when unextracted. */
  normalizedText: string;
  textSha256: string;
  extractorVersion: string;
  status: "EXTRACTED" | "UNEXTRACTED";
  observations: ObservationRow[];
  diagnosticCodes: string[];
  captureDate: string;
  consentedAt: Date | null;
}

/**
 * Builds one submit_evidence_text argument. Throws when the item has no
 * recorded consent: inclusion in a packet is an explicit per-item
 * consented act (ARCHITECTURE §8.2), enforced at build time so the
 * unconsented path is unrepresentable.
 */
export function evidenceWritePayload(item: ItemForPacket): string {
  if (!item.consentedAt) {
    throw new Error(
      `evidence ${item.evidenceId}: no publicity consent recorded — ` +
        "an item enters a packet only through an explicit consent act",
    );
  }
  const payload: EvidenceWritePayload = {
    evidence_id: item.evidenceId,
    declared_class: item.declaredClass,
    declared_label: item.declaredLabel,
    uploader_account: item.uploaderAccount,
    uploader_role: item.uploaderRole,
    file_sha256: item.fileSha256,
    text_sha256: item.textSha256,
    extractor_version: item.extractorVersion,
    status: item.status,
    text: item.status === "EXTRACTED" ? item.normalizedText : "",
    observations: item.observations,
    diagnostic_codes: item.diagnosticCodes,
    capture_date: item.captureDate,
  };
  return JSON.stringify(payload);
}

export function manifestEntriesOf(items: ItemForPacket[]): ManifestEntry[] {
  return items.map((i) => ({
    evidenceId: i.evidenceId,
    fileSha256: i.fileSha256,
    textSha256: i.textSha256,
    extractorVersion: i.extractorVersion,
  }));
}
