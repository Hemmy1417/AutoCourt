import { describe, expect, it } from "vitest";

import { extractEvidence } from "../lib/evidence/extract";
import { sha256Bytes, sha256Text } from "../lib/evidence/hash";
import { normalizeText, PER_ITEM_TEXT_CAP } from "../lib/evidence/normalize";
import { applyRedactions, REDACTION_MARK } from "../lib/evidence/redact";
import { sniffKind } from "../lib/evidence/sniff";

const enc = new TextEncoder();

describe("hashing", () => {
  it("text hash matches the contract's utf-8 sha256", async () => {
    // hashlib.sha256("hello world".encode()).hexdigest()
    expect(await sha256Text("hello world")).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("hashes non-ASCII text as UTF-8, as the contract does", async () => {
    // Python: hashlib.sha256(("87,432 mi " + chr(0x2013) + " no" + chr(0x2011) + "rust").encode()).hexdigest()
    const text = `87,432 mi ${String.fromCharCode(0x2013)} no${String.fromCharCode(0x2011)}rust`;
    expect(await sha256Text(text)).toBe("0a84178abcaa7c130e2cba4de3877b57ff7c1fa4ac495f03efcf479b4ba1ec44");
  });

  it("byte and text hashes agree on ascii", async () => {
    expect(await sha256Bytes(enc.encode("abc"))).toBe(await sha256Text("abc"));
  });
});

describe("magic-byte sniffing", () => {
  it("never trusts an extension: bytes decide", () => {
    expect(sniffKind(enc.encode("%PDF-1.7 rest of file"))).toBe("pdf");
    expect(sniffKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe("png");
    expect(sniffKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffKind(enc.encode("plain service invoice text"))).toBe("text");
    expect(sniffKind(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBe("unknown");
  });
});

describe("normalization", () => {
  it("collapses whitespace deterministically", () => {
    expect(normalizeText("a\r\n\r\n\r\nb\t\tc   d")).toBe("a\n\nb c d");
  });

  it("caps on a word boundary so quotes still ground", () => {
    const out = normalizeText("word ".repeat(2000));
    expect(out.length).toBeLessThanOrEqual(PER_ITEM_TEXT_CAP);
    expect(out.endsWith("word")).toBe(true);
  });
});

describe("redaction before publishing", () => {
  it("replaces spans and changes the committed hash", async () => {
    const text = "Owner John Smith paid 4,500 for the repair.";
    const redacted = applyRedactions(text, [{ start: 6, end: 16 }]);
    expect(redacted).toBe(`Owner ${REDACTION_MARK} paid 4,500 for the repair.`);
    expect(await sha256Text(redacted)).not.toBe(await sha256Text(text));
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
    const pdf = "%PDF-1.4\n1 0 obj\nstream\nBT /F1 12 Tf (Odometer 87,432 miles) Tj ET\nendstream\nendobj\ntrailer";
    const got = await extractEvidence(enc.encode(pdf));
    expect(got.status).toBe("EXTRACTED");
    expect(got.normalizedText).toContain("Odometer 87,432 miles");
  });

  it("records an image as unavailable instead of fabricating text", async () => {
    const got = await extractEvidence(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 1, 1]));
    expect(got.status).toBe("UNAVAILABLE");
    expect(got.normalizedText).toBe("");
    expect(got.kind).toBe("png");
  });

  it("records a scanned pdf with no literal text as unavailable", async () => {
    expect((await extractEvidence(enc.encode("%PDF-1.4 binaryimagedata"))).status).toBe("UNAVAILABLE");
  });
});
