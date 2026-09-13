/**
 * Cursor pagination for every list endpoint: an opaque base64url cursor
 * over (createdAt, id) — stable under inserts, no offsets.
 */

export interface Cursor {
  createdAt: string; // ISO
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as Cursor;
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string")
      return null;
    if (Number.isNaN(Date.parse(parsed.createdAt))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clampLimit(raw: string | null, fallback = 20, max = 50): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(n)));
}
