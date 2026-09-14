/**
 * Redaction runs BEFORE packet build, and the redacted text is what
 * text_sha256 commits (design review, blocking privacy finding):
 * adjudicated text is permanent public calldata, so redaction after
 * submission is impossible and the pipeline enforces the ordering by
 * construction — the packet builder only ever sees the redacted output.
 */

export interface RedactionSpan {
  /** Inclusive character start in the NORMALIZED text. */
  start: number;
  /** Exclusive character end. */
  end: number;
  /** Short reason shown in the UI; never entered into the packet. */
  reason?: string;
}

export const REDACTION_MARK = "[REDACTED]";

export function applyRedactions(
  normalized: string,
  spans: RedactionSpan[],
): string {
  if (spans.length === 0) return normalized;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let cursor = 0;
  let out = "";
  for (const span of sorted) {
    const start = Math.max(0, Math.min(span.start, normalized.length));
    const end = Math.max(start, Math.min(span.end, normalized.length));
    if (start < cursor) {
      throw new Error("redaction spans must not overlap");
    }
    out += normalized.slice(cursor, start) + REDACTION_MARK;
    cursor = end;
  }
  out += normalized.slice(cursor);
  return out;
}
