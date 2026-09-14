/**
 * The typed read layer.
 *
 * Every contract view returns canonical JSON. Callers never see that: they
 * get a parsed, typed object, null for a record that does not exist, or a
 * ReadError whose message a person can act on.
 *
 * READS GO STRAIGHT FROM THIS BROWSER TO STUDIO NEXT, paced. Measured
 * against Studio Next (14 Sep): contract reads (gen_call) share a
 * 30-per-minute bucket per IP; twelve concurrent reads all succeed, and
 * past the budget the RPC answers HTTP 429 with a JSON-RPC error (-32029)
 * and CORS headers, so a browser can read the refusal and wait. A server
 * proxy would pool every visitor into one budget; reading from the
 * visitor's own connection gives each of them their own. This layer keeps
 * a tab well under the limit, because the wallet's fee estimates spend
 * from the same bucket.
 */
import { createClient } from "genlayer-js";

import { isTransient, STUDIO_NEXT } from "./chain";
import { CONTRACT_ADDRESS, CONTRACT_CONFIGURED } from "./config";
import type {
  ChainConfig,
  ItemRecord,
  ManifestView,
  RecordView,
  RunView,
  VerdictView,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = any;

/** Thrown when the chain could not be read. Carries text a person can act on. */
export class ReadError extends Error {
  readonly transient: boolean;
  constructor(message: string, transient: boolean) {
    super(message);
    this.name = "ReadError";
    this.transient = transient;
  }
}

let client: Client | null = null;

function readClient(): Client {
  if (!CONTRACT_CONFIGURED) {
    throw new ReadError("No contract is configured for this build, so there is nothing to read.", false);
  }
  // No account: reads are unsigned. Requiring a wallet to LOOK at a record
  // would make a public record private to its parties.
  if (!client) client = createClient({ chain: { ...STUDIO_NEXT } });
  return client;
}

/** Every string an error and its cause chain carry, joined. */
function errorText(err: unknown): string {
  const parts: string[] = [];
  let node: unknown = err;
  for (let depth = 0; depth < 6 && typeof node === "object" && node !== null; depth++) {
    const e = node as Record<string, unknown>;
    for (const key of ["message", "shortMessage", "details"]) {
      if (typeof e[key] === "string" && e[key]) parts.push(e[key] as string);
    }
    node = e.cause;
  }
  if (parts.length === 0) parts.push(String(err ?? ""));
  return parts.join(" ");
}

const RATE_LIMITED = /rate limit|-32029|\b429\b/i;

function asReadError(err: unknown): ReadError {
  if (err instanceof ReadError) return err;
  const msg = errorText(err);
  if (RATE_LIMITED.test(msg)) {
    return new ReadError("Studio Next is limiting how fast this page can read. It recovers on its own within a minute.", true);
  }
  return new ReadError(
    isTransient(msg)
      ? "The chain could not be reached just now. Retrying usually works."
      : msg.slice(0, 200) || "The chain refused this read.",
    isTransient(msg),
  );
}

// ── pacing ──────────────────────────────────────────────────────────────────

/** Under the 30-per-minute bucket with room for the wallet's own estimates. */
export const READS_PER_MINUTE = 20;
const WINDOW_MS = 60_000;

const stamps: number[] = [];
let queue: Promise<void> = Promise.resolve();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for a slot in the sliding window. Slots are handed out in arrival
 * order through one promise chain, so a burst of reads cannot all see the
 * same free window and overspend it together.
 */
export function acquireReadSlot(now: () => number = Date.now): Promise<void> {
  const turn = queue.then(async () => {
    for (;;) {
      const t = now();
      while (stamps.length && t - stamps[0]! >= WINDOW_MS) stamps.shift();
      if (stamps.length < READS_PER_MINUTE) {
        stamps.push(t);
        return;
      }
      await sleep(Math.min(WINDOW_MS - (t - stamps[0]!) + 50, 5_000));
    }
  });
  queue = turn.catch(() => undefined);
  return turn;
}

// ── caching ─────────────────────────────────────────────────────────────────

type Entry = { at: number; value: unknown; ttl: number };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/** Chain limits and sealed history cannot change: read once. */
export const TTL_IMMUTABLE = Number.POSITIVE_INFINITY;
/** A record in motion: long enough to collapse a render, short enough to see a write land. */
export const TTL_LIVE = 5_000;

/** Drop cached live reads so the next call goes to the chain. */
export function invalidateReads(): void {
  for (const [k, e] of cache) if (e.ttl !== TTL_IMMUTABLE) cache.delete(k);
}

/** The view answered that the thing asked about does not exist. */
class Missing extends Error {}

/**
 * One contract view: paced, cached, de-duplicated, and retried through a
 * rate-limit refusal. `ttl` may depend on the answer, because some answers
 * decide their own lifetime.
 */
export async function call<T>(
  functionName: string,
  args: unknown[],
  parse: (raw: string) => T,
  ttl: number | ((value: T) => number),
  force = false,
): Promise<T> {
  const key = `${functionName}(${JSON.stringify(args)})`;
  if (!force) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < hit.ttl) return hit.value as T;
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;
  }

  const p = (async () => {
    try {
      let raw: unknown;
      for (let attempt = 0; ; attempt++) {
        await acquireReadSlot();
        try {
          raw = await readClient().readContract({
            address: CONTRACT_ADDRESS as `0x${string}`,
            functionName,
            args,
          });
          break;
        } catch (err) {
          const text = errorText(err);
          // The contract's own "does not exist" is an answer, not a failure.
          if (/\[EXPECTED\] (unknown|no )/.test(text)) throw new Missing(text);
          if (attempt < 3 && (RATE_LIMITED.test(text) || isTransient(text))) {
            await sleep(3_000 * 2 ** attempt);
            continue;
          }
          throw asReadError(err);
        }
      }
      const value = parse(typeof raw === "string" ? raw : JSON.stringify(raw));
      cache.set(key, { at: Date.now(), value, ttl: typeof ttl === "function" ? ttl(value) : ttl });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof Missing) return null;
    throw err;
  }
}

const json = <T,>(raw: string) => JSON.parse(raw) as T;

// ── typed views ─────────────────────────────────────────────────────────────

/** One record, or null when the contract has none by that id. */
export function getRecord(id: string, force = false): Promise<RecordView | null> {
  return orNull(call("get_assessment", [id], json<RecordView>, TTL_LIVE, force));
}

/** Record ids in creation order; `limit` is capped at 50 by the contract. */
export function getRecordIds(offset: number, limit: number, force = false): Promise<string[]> {
  return call("get_assessments", [offset, limit], json<string[]>, TTL_LIVE, force);
}

export function getStats(force = false): Promise<{ assessments: number }> {
  return call("get_stats", [], json<{ assessments: number }>, TTL_LIVE, force);
}

/** Module constants: fixed for the life of a deployment. */
export function getConfig(): Promise<ChainConfig> {
  return call("get_config", [], json<ChainConfig>, TTL_IMMUTABLE);
}

/** The full stored item. Its text never changes; its appeal tag can. */
export function getItem(id: string, evidenceId: string, force = false): Promise<ItemRecord | null> {
  return orNull(call("get_item_text", [id, evidenceId], json<ItemRecord>, TTL_LIVE, force));
}

/** A sealed manifest is written once and never edited. */
export function getManifest(id: string, version: number): Promise<ManifestView | null> {
  return orNull(call("get_manifest", [id, version], json<ManifestView>, TTL_IMMUTABLE));
}

/** A run is written once and never edited. */
export function getRun(id: string, n: number): Promise<RunView | null> {
  return orNull(call("get_run", [id, n], json<RunView>, TTL_IMMUTABLE));
}

export function getVerdict(id: string, force = false): Promise<VerdictView | null> {
  return orNull(call("get_verdict", [id], json<VerdictView>, TTL_LIVE, force));
}

// ── transaction finality ────────────────────────────────────────────────────

export type TxFinalityView = {
  /** The chain's word for where the transaction is; "UNKNOWN" when it named none. */
  statusName: string;
  /** True once the chain reports FINALIZED: it will not walk this back. */
  finalized: boolean;
  /** What the deciding execution did, read from the leader receipt. */
  executed: "SUCCESS" | "ERROR" | "UNKNOWN";
};

/** Numeric status → name, from the SDK's enum order (FINALIZED is 7 on the wire). */
const STATUS_BY_NUMBER: Record<number, string> = {
  0: "UNINITIALIZED", 1: "PENDING", 2: "PROPOSING", 3: "COMMITTING",
  4: "REVEALING", 5: "ACCEPTED", 6: "UNDETERMINED", 7: "FINALIZED",
  8: "CANCELED", 9: "APPEAL_REVEALING", 10: "APPEAL_COMMITTING",
  11: "READY_TO_FINALIZE", 12: "VALIDATORS_TIMEOUT", 13: "LEADER_TIMEOUT",
};

/**
 * Whatever the RPC returned for a transaction, as the three facts lib/tx.ts
 * acts on. A refused write also finalizes MAJORITY_AGREE (the panel agreed
 * it errored), so success is read from the deciding leader receipt, entry 0,
 * and never from the consensus result.
 */
export function normalizeTxView(t: unknown): TxFinalityView {
  const tx = (typeof t === "object" && t !== null ? t : {}) as Record<string, unknown>;
  let statusName = "UNKNOWN";
  if (typeof tx.statusName === "string" && tx.statusName) statusName = tx.statusName;
  else if (typeof tx.status === "number" && STATUS_BY_NUMBER[tx.status]) statusName = STATUS_BY_NUMBER[tx.status]!;
  else if (typeof tx.status === "string" && tx.status) statusName = tx.status;

  let executed: TxFinalityView["executed"] = "UNKNOWN";
  const consensus = tx.consensus_data as { leader_receipt?: Array<{ execution_result?: unknown }> } | undefined;
  const deciding = consensus?.leader_receipt?.[0]?.execution_result;
  if (deciding === "SUCCESS" || deciding === "FINISHED_WITH_RETURN") executed = "SUCCESS";
  else if (deciding === "ERROR" || deciding === "FINISHED_WITH_ERROR") executed = "ERROR";

  return { statusName, finalized: statusName === "FINALIZED", executed };
}

const NOT_SEEN: TxFinalityView = { statusName: "UNKNOWN", finalized: false, executed: "UNKNOWN" };

function isNotSeen(err: unknown): boolean {
  const e = err as { name?: unknown; message?: unknown } | undefined;
  if (e?.name === "ResourceNotFoundRpcError" || e?.name === "TransactionNotFoundError") return true;
  return /could not be found|resource not found/i.test(String(e?.message ?? ""));
}

/** One status poll of a submitted transaction. Never cached: the point is to see change. */
export async function getTransactionStatus(hash: string): Promise<TxFinalityView> {
  let raw: unknown;
  try {
    raw = await readClient().getTransaction({ hash: hash as `0x${string}` });
  } catch (err) {
    if (isNotSeen(err)) return NOT_SEEN;
    throw asReadError(err);
  }
  if (raw === null || raw === undefined) return NOT_SEEN;
  return normalizeTxView(raw);
}
