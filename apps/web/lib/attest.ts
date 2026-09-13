/**
 * The uploader's attestation over their own bytes.
 *
 * Signed at CONSENT, not at upload: redaction changes the normalized
 * text and therefore its hash, so the only honest moment to attest is
 * when the bytes are final and the uploader is choosing to publish them.
 * One wallet prompt, covering exactly what goes on the record.
 *
 * The message is built by this one function on both sides — the browser
 * that signs it and the server that verifies it — so they can never
 * drift apart.
 */

export const ATTESTATION_VERSION = "autocourt-attestation-1";

export function attestationMessage(opts: {
  evidenceId: string;
  textSha256: string;
  fileSha256: string;
}): string {
  return (
    `AutoCourt evidence attestation (${ATTESTATION_VERSION})\n\n` +
    `evidence: ${opts.evidenceId}\n` +
    `document sha256: ${opts.fileSha256}\n` +
    `judged text sha256: ${opts.textSha256}\n\n` +
    "Signing records that these are the bytes I uploaded. The signature " +
    "goes on a public record beside the hash it covers, so anyone can " +
    "check later that this evidence was not substituted."
  );
}
