/**
 * SHA-256 through WebCrypto, which the browser and Node 22 both provide, so
 * the same function fingerprints a file in the page and in the tests.
 */

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** sha256 hex over raw bytes: the identity of an original file. */
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return hex(await crypto.subtle.digest("SHA-256", copy.buffer));
}

/**
 * sha256 hex over UTF-8 text: the identity of the JUDGED bytes. Must match
 * the contract's `_sha256_hex`, which recomputes it over the supplied text at
 * entry and refuses a mismatch.
 */
export async function sha256Text(text: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(text));
}
