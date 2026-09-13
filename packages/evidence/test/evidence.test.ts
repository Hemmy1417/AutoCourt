import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  applyRedactions,
  extractEvidence,
  LocalDiskStorage,
  normalizeText,
  PER_ITEM_TEXT_CAP,
  REDACTION_MARK,
  sha256Bytes,
  sha256Text,
  sniffKind,
} from "../src/index.js";

const enc = new TextEncoder();

describe("hashing", () => {
  it("text hash matches the contract's utf-8 sha256", () => {
    // Precomputed: hashlib.sha256("hello world".encode()).hexdigest()
    expect(sha256Text("hello world")).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  it("byte and text hashes agree on ascii", () => {
    expect(sha256Bytes(enc.encode("abc"))).toBe(sha256Text("abc"));
  });
});

describe("magic-byte sniffing", () => {
  it("never trusts an extension: bytes decide", () => {
    expect(sniffKind(enc.encode("%PDF-1.7 rest of file"))).toBe("pdf");
    expect(sniffKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])))
      .toBe("png");
    expect(sniffKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffKind(enc.encode("plain service invoice text"))).toBe("text");
    expect(sniffKind(new Uint8Array([0x00, 0x01, 0x02, 0x03])))
      .toBe("unknown");
  });
});

describe("normalization", () => {
  it("collapses whitespace deterministically", () => {
    expect(normalizeText("a\r\n\r\n\r\nb\t\tc   d")).toBe("a\n\nb c d");
  });

  it("caps on a word boundary so quotes still ground", () => {
    const long = "word ".repeat(2000);
    const out = normalizeText(long);
    expect(out.length).toBeLessThanOrEqual(PER_ITEM_TEXT_CAP);
    expect(out.endsWith("word")).toBe(true);
  });
});

describe("redaction before the packet", () => {
  it("replaces spans and changes the committed hash", () => {
    const text = "Owner John Smith paid 4,500 for the repair.";
    const redacted = applyRedactions(text, [{ start: 6, end: 16 }]);
    expect(redacted).toBe(`Owner ${REDACTION_MARK} paid 4,500 for the repair.`);
    expect(sha256Text(redacted)).not.toBe(sha256Text(text));
  });

  it("refuses overlapping spans", () => {
    expect(() =>
      applyRedactions("abcdef", [
        { start: 0, end: 4 },
        { start: 2, end: 6 },
      ]),
    ).toThrow(/overlap/);
  });
});

describe("extraction honesty", () => {
  it("extracts plain text", async () => {
    const got = await extractEvidence(enc.encode("INVOICE. 87,432 miles."));
    expect(got.status).toBe("EXTRACTED");
    expect(got.normalizedText).toBe("INVOICE. 87,432 miles.");
  });

  it("extracts literal text from an uncompressed PDF stream", async () => {
    const pdf =
      "%PDF-1.4\n1 0 obj\nstream\nBT /F1 12 Tf (Odometer 87,432 miles) Tj ET" +
      "\nendstream\nendobj\ntrailer";
    const got = await extractEvidence(enc.encode(pdf));
    expect(got.status).toBe("EXTRACTED");
    expect(got.normalizedText).toContain("Odometer 87,432 miles");
  });

  it("records UNAVAILABLE for an image instead of fabricating", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 1, 1]);
    const got = await extractEvidence(png);
    expect(got.status).toBe("UNAVAILABLE");
    expect(got.normalizedText).toBe("");
    expect(got.kind).toBe("png");
  });

  it("records UNAVAILABLE for a scanned pdf with no literal text", async () => {
    const got = await extractEvidence(enc.encode("%PDF-1.4 binaryimagedata"));
    expect(got.status).toBe("UNAVAILABLE");
  });
});

describe("storage", () => {
  it("stores under the hash, never the upload filename", async () => {
    const root = await mkdtemp(join(tmpdir(), "ac-evidence-"));
    const store = new LocalDiskStorage(root);
    const bytes = enc.encode("original file bytes");
    const hash = await store.put(bytes);
    expect(hash).toBe(sha256Bytes(bytes));
    expect(await store.exists(hash)).toBe(true);
    expect(Buffer.from(await store.get(hash)).toString()).toBe(
      "original file bytes",
    );
    expect(await store.exists("0".repeat(64))).toBe(false);
    await expect(store.get("../../etc/passwd" as string)).rejects.toThrow(
      /invalid storage key/,
    );
  });
});
