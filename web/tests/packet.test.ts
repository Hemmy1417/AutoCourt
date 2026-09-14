import { describe, expect, it } from "vitest";

import { anchorItemJson, manifestRoot, nextEvidenceId, uploadedItemJson } from "../lib/packet";

describe("manifest root", () => {
  it("matches the contract's _manifest_root byte for byte (golden)", async () => {
    // Golden computed by running the contract module's own _manifest_root.
    const root = await manifestRoot([
      { evidenceId: "E-SVC", fileSha256: "a".repeat(64), textSha256: "b".repeat(64), extractorVersion: "extractor-1.0.0" },
      { evidenceId: "E-HIST", fileSha256: "c".repeat(64), textSha256: "d".repeat(64), extractorVersion: "extractor-1.0.0" },
    ]);
    expect(root).toBe("3abed7faf52fa5aee5f38892e0feb52912bee2743721c24557387f4e1c8436eb");
  });

  it("is order independent and text-hash sensitive", async () => {
    const a = { evidenceId: "E-A", fileSha256: "1".repeat(64), textSha256: "2".repeat(64), extractorVersion: "x" };
    const b = { evidenceId: "E-B", fileSha256: "3".repeat(64), textSha256: "4".repeat(64), extractorVersion: "x" };
    expect(await manifestRoot([a, b])).toBe(await manifestRoot([b, a]));
    expect(await manifestRoot([a, { ...b, textSha256: "5".repeat(64) }])).not.toBe(await manifestRoot([a, b]));
  });
});

describe("evidence ids", () => {
  it("numbers the next item after the ones on the record", () => {
    expect(nextEvidenceId([])).toBe("E-001");
    expect(nextEvidenceId([{ evidence_id: "E-001" }, { evidence_id: "E-002" }])).toBe("E-003");
  });

  it("skips an id already taken, whoever took it", () => {
    expect(nextEvidenceId([{ evidence_id: "E-002" }])).toBe("E-003");
  });
});

describe("write payloads", () => {
  it("builds the contract's argument shape for an uploaded item", () => {
    const parsed = JSON.parse(
      uploadedItemJson({
        evidence_id: "E-001",
        declared_class: "SERVICE_INVOICE",
        declared_label: "Invoice",
        uploader_account: "0xabc",
        uploader_role: "SELLER",
        file_sha256: "a".repeat(64),
        text_sha256: "b".repeat(64),
        extractor_version: "extractor-1.0.0",
        status: "EXTRACTED",
        text: "Odometer 87,432 miles.",
        uploader_signature: "",
        observations: [{ doc_date: "2026-03-07", odometer_reading: 87432, odometer_unit: "MILES", source_field: "odometer" }],
        diagnostic_codes: [],
        capture_date: "2026-03-07",
      }),
    );
    expect(parsed.text).toBe("Odometer 87,432 miles.");
    expect(parsed.observations[0].odometer_reading).toBe(87432);
  });

  it("never sends text for an item whose text could not be extracted", () => {
    const parsed = JSON.parse(
      uploadedItemJson({
        evidence_id: "E-002",
        declared_class: "IMAGE",
        declared_label: "",
        uploader_account: "0xabc",
        uploader_role: "BUYER",
        file_sha256: "a".repeat(64),
        text_sha256: "b".repeat(64),
        extractor_version: "extractor-1.0.0",
        status: "UNEXTRACTED",
        text: "anything",
        uploader_signature: "",
        observations: [],
        diagnostic_codes: [],
        capture_date: "",
      }),
    );
    expect(parsed.text).toBe("");
  });

  it("marks an independent source with the one class only validators fill", () => {
    const parsed = JSON.parse(anchorItemJson({ evidence_id: "E-003", declared_label: "Registry", url: "https://x", expected_sha256: "c".repeat(64) }));
    expect(parsed.declared_class).toBe("EXTERNAL_SOURCE_RESULT");
  });
});
