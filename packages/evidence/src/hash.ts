import { createHash } from "node:crypto";

/** sha256 hex over raw bytes — the identity of an original file. */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * sha256 hex over UTF-8 text — the identity of the JUDGED bytes. Must
 * match the contract's `_sha256_hex` exactly: the contract recomputes
 * this over the supplied text at entry and refuses a mismatch.
 */
export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
