import { describe, expect, it } from "vitest";

import {
  evidenceWritePayload,
  manifestEntriesOf,
  manifestRoot,
  type ItemForPacket,
} from "../lib/packet.js";
import { decodeCursor, encodeCursor, clampLimit } from "../lib/cursor.js";
import { allowBoth, resetBuckets } from "../lib/ratelimit.js";
import { signToken, verifyToken } from "../lib/auth.js";

describe("manifest root", () => {
  it("matches the contract's _manifest_root byte-for-byte (golden)", () => {
    // Golden computed by running the ACTUAL contract module:
    //   _manifest_root([{E-SVC, a*64, b*64, extractor-1.0.0},
    //                   {E-HIST, c*64, d*64, extractor-1.0.0}])
    const root = manifestRoot([
      {
        evidenceId: "E-SVC",
        fileSha256: "a".repeat(64),
        textSha256: "b".repeat(64),
        extractorVersion: "extractor-1.0.0",
      },
      {
        evidenceId: "E-HIST",
        fileSha256: "c".repeat(64),
        textSha256: "d".repeat(64),
        extractorVersion: "extractor-1.0.0",
      },
    ]);
    expect(root).toBe(
      "3abed7faf52fa5aee5f38892e0feb52912bee2743721c24557387f4e1c8436eb",
    );
  });

  it("is order independent and text-hash sensitive", () => {
    const a = {
      evidenceId: "E-A",
      fileSha256: "1".repeat(64),
      textSha256: "2".repeat(64),
      extractorVersion: "x",
    };
    const b = {
      evidenceId: "E-B",
      fileSha256: "3".repeat(64),
      textSha256: "4".repeat(64),
      extractorVersion: "x",
    };
    expect(manifestRoot([a, b])).toBe(manifestRoot([b, a]));
    expect(manifestRoot([a, { ...b, textSha256: "5".repeat(64) }])).not.toBe(
      manifestRoot([a, b]),
    );
  });
});

const baseItem: ItemForPacket = {
  evidenceId: "E-SVC",
  declaredClass: "SERVICE_INVOICE",
  declaredLabel: "Invoice",
  uploaderAccount: "acct-seller",
  uploaderRole: "SELLER",
  fileSha256: "a".repeat(64),
  normalizedText: "Odometer reading 87,432 miles at service.",
  textSha256: "b".repeat(64),
  extractorVersion: "extractor-1.0.0",
  status: "EXTRACTED",
  uploaderSignature: "0x" + "ab".repeat(65),
  observations: [],
  diagnosticCodes: [],
  captureDate: "2026-03-07",
  consentedAt: new Date("2026-06-01T00:00:00Z"),
};

describe("evidence write payload", () => {
  it("builds the contract's exact argument shape", () => {
    const parsed = JSON.parse(evidenceWritePayload(baseItem));
    expect(parsed.evidence_id).toBe("E-SVC");
    expect(parsed.text).toContain("87,432");
    expect(parsed.text_sha256).toBe("b".repeat(64));
  });

  it("refuses an item without recorded publicity consent", () => {
    expect(() =>
      evidenceWritePayload({ ...baseItem, consentedAt: null }),
    ).toThrow(/consent/);
  });

  it("an unextracted item carries no text", () => {
    const parsed = JSON.parse(
      evidenceWritePayload({
        ...baseItem,
        status: "UNEXTRACTED",
        normalizedText: "should never appear",
      }),
    );
    expect(parsed.text).toBe("");
  });

  it("carries the uploader's attestation onto the record", () => {
    const parsed = JSON.parse(evidenceWritePayload(baseItem));
    expect(parsed.uploader_signature).toBe("0x" + "ab".repeat(65));
    // An unsigned item is carried as unsigned, never omitted.
    const unsigned = JSON.parse(
      evidenceWritePayload({ ...baseItem, uploaderSignature: "" }),
    );
    expect(unsigned.uploader_signature).toBe("");
  });

  it("manifest entries mirror the four committed fields", () => {
    const [entry] = manifestEntriesOf([baseItem]);
    expect(entry).toEqual({
      evidenceId: "E-SVC",
      fileSha256: "a".repeat(64),
      textSha256: "b".repeat(64),
      extractorVersion: "extractor-1.0.0",
    });
  });
});

describe("cursor pagination", () => {
  it("round-trips and rejects garbage", () => {
    const c = { createdAt: "2026-06-01T00:00:00.000Z", id: "abc" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor("not-base64!@#")).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });

  it("clamps limits", () => {
    expect(clampLimit(null)).toBe(20);
    expect(clampLimit("999")).toBe(50);
    expect(clampLimit("-3")).toBe(1);
    expect(clampLimit("junk")).toBe(20);
  });
});

describe("rate limiting", () => {
  it("bounds a burst per key and refills over time", () => {
    resetBuckets();
    const t0 = 1_000_000;
    let allowed = 0;
    for (let i = 0; i < 30; i++) {
      if (allowBoth("assess", "sess-1", "1.2.3.4", t0)) allowed += 1;
    }
    expect(allowed).toBe(6); // assess capacity
    // 40 seconds later two tokens have refilled (0.05/s).
    expect(allowBoth("assess", "sess-1", "1.2.3.4", t0 + 40_000)).toBe(true);
  });

  it("a different session on the same IP shares the IP bucket", () => {
    resetBuckets();
    const t0 = 2_000_000;
    for (let i = 0; i < 6; i++) allowBoth("assess", `s-${i}`, "9.9.9.9", t0);
    expect(allowBoth("assess", "s-new", "9.9.9.9", t0)).toBe(false);
  });
});

describe("session tokens", () => {
  it("signs and verifies; tampering fails", () => {
    const token = signToken("session-123", "test-secret-0123456789");
    expect(verifyToken(token, "test-secret-0123456789")).toBe("session-123");
    expect(verifyToken(token + "x", "test-secret-0123456789")).toBeNull();
    expect(verifyToken(token, "other-secret-0123456789")).toBeNull();
  });
});
