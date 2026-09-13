/**
 * Magic-byte type sniffing — the extension and the declared MIME are
 * party-supplied and never trusted (brief §15). The sniffed kind decides
 * which extractor runs and what the storage layer will serve.
 */

export type SniffedKind =
  | "pdf"
  | "png"
  | "jpeg"
  | "gif"
  | "webp"
  | "mp4"
  | "text"
  | "unknown";

const startsWith = (b: Uint8Array, sig: number[], offset = 0): boolean =>
  sig.every((v, i) => b[offset + i] === v);

export function sniffKind(bytes: Uint8Array): SniffedKind {
  if (bytes.length >= 5 && startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]))
    return "pdf"; // %PDF-
  if (bytes.length >= 8 && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]))
    return "png";
  if (bytes.length >= 3 && startsWith(bytes, [0xff, 0xd8, 0xff]))
    return "jpeg";
  if (bytes.length >= 6 && startsWith(bytes, [0x47, 0x49, 0x46, 0x38]))
    return "gif";
  if (
    bytes.length >= 12 &&
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  )
    return "webp";
  if (bytes.length >= 12 && startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4))
    return "mp4"; // ....ftyp
  return looksLikeText(bytes) ? "text" : "unknown";
}

/** Conservative text heuristic: no NUL bytes, mostly printable/UTF-8. */
function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let control = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 0x09 || (b > 0x0d && b < 0x20)) control += 1;
  }
  return control / sample.length < 0.02;
}

export function mimeFor(kind: SniffedKind): string {
  switch (kind) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "mp4":
      return "video/mp4";
    case "text":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}
