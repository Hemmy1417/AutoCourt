/**
 * Third-party extraction check: recompute the hashes the on-chain
 * manifest commits, from artifacts in your hands.
 *
 *   node scripts/verify-extraction.mjs original <file> [expected_text_sha256]
 *       Runs the pipeline (magic-byte sniff → extract → normalize) over an
 *       ORIGINAL file and prints file_sha256 + the UNREDACTED normalized
 *       text hash. For an unredacted item this must equal the manifest's
 *       text_sha256; for a redacted item it will differ by design — use
 *       `text` mode on the served normalized text instead.
 *
 *   node scripts/verify-extraction.mjs text <file> [expected_text_sha256]
 *       Hashes the exact text bytes of <file> (the normalized text a party
 *       downloaded from the app or read from chain state) the way the
 *       contract does at entry.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// The pipeline lives in the workspace package; run from the repo root.
const { extractEvidence } = await import("../packages/evidence/src/extract.ts")
  .catch(async () => import("@autocourt/evidence"));

const [mode, path, expected] = process.argv.slice(2);
if (!mode || !path) {
  console.error("usage: verify-extraction.mjs original|text <file> [expected_text_sha256]");
  process.exit(2);
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

if (mode === "text") {
  const text = readFileSync(path, "utf-8");
  const hash = createHash("sha256").update(text, "utf8").digest("hex");
  console.log(`text_sha256(${path}) = ${hash}`);
  if (expected) {
    console.log(hash === expected.toLowerCase() ? "MATCH" : "MISMATCH");
    process.exit(hash === expected.toLowerCase() ? 0 : 1);
  }
} else if (mode === "original") {
  const bytes = new Uint8Array(readFileSync(path));
  console.log(`file_sha256(${path}) = ${sha256(bytes)}`);
  const got = await extractEvidence(bytes);
  console.log(`extraction: ${got.status} (${got.kind})`);
  const textHash = createHash("sha256")
    .update(got.normalizedText, "utf8")
    .digest("hex");
  console.log(`unredacted normalized text_sha256 = ${textHash}`);
  console.log(
    "note: a REDACTED item's manifest hash covers the redacted text — " +
      "verify that one in `text` mode against the served normalized text",
  );
  if (expected) {
    console.log(textHash === expected.toLowerCase() ? "MATCH" : "MISMATCH");
    process.exit(textHash === expected.toLowerCase() ? 0 : 1);
  }
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
