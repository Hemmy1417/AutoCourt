/**
 * Deterministic token-bucket rate limiting, per session AND per IP
 * (brief §11/§15 — doubly required, guarding the expensive adjudication
 * path). In-process state: sufficient for one server or one serverless
 * instance; the DB-backed Job queue is what actually serializes chain
 * writes, so the bucket only shields the API surface.
 */

interface Bucket {
  tokens: number;
  refilledAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateRule {
  capacity: number;
  refillPerSecond: number;
}

export const RULES: Record<string, RateRule> = {
  auth: { capacity: 10, refillPerSecond: 0.2 },
  upload: { capacity: 20, refillPerSecond: 0.5 },
  assess: { capacity: 6, refillPerSecond: 0.05 },
  read: { capacity: 120, refillPerSecond: 10 },
};

export function allow(
  rule: keyof typeof RULES,
  key: string,
  now = Date.now(),
): boolean {
  const r = RULES[rule];
  if (!r) return true;
  const id = `${rule}:${key}`;
  const b = buckets.get(id) ?? { tokens: r.capacity, refilledAt: now };
  const elapsed = Math.max(0, now - b.refilledAt) / 1000;
  b.tokens = Math.min(r.capacity, b.tokens + elapsed * r.refillPerSecond);
  b.refilledAt = now;
  if (b.tokens < 1) {
    buckets.set(id, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(id, b);
  return true;
}

/** Both keys must pass: a shared IP cannot starve a session, nor hide one. */
export function allowBoth(
  rule: keyof typeof RULES,
  sessionKey: string | null,
  ip: string,
  now = Date.now(),
): boolean {
  const ipOk = allow(rule, `ip:${ip}`, now);
  const sessionOk = sessionKey
    ? allow(rule, `s:${sessionKey}`, now)
    : true;
  return ipOk && sessionOk;
}

/** Test hook. */
export function resetBuckets(): void {
  buckets.clear();
}
