/**
 * The transaction lifecycle. Every rule below was learned against Studio
 * Next:
 *
 *   A WRITE IS SIZED BEFORE IT IS SIGNED. Studio Next reverts a transaction
 *   with no fee distribution or a zero deposit, and genlayer-js 2.0.0-rc.1
 *   does not fill those in. A deterministic write is SIMULATED to size it
 *   (estimateTransactionFeesForWrite); the simulation runs the method, so a
 *   write the contract would refuse fails right there, with the contract's
 *   own sentence, before the wallet ever opens. A write that fetches the web
 *   or runs the panel is sized with the plain estimate (see estimateFees).
 *
 *   CONFIRMATION IS A CONTRACT READ, NOT A RECEIPT. A submitted transaction
 *   is not a changed state. Every write closes by polling a predicate: "is
 *   the thing I asked for now true on the record?"
 *
 *   A CONTRACT READ IS NOT FINALITY EITHER. The predicate turning true proves
 *   the write was ACCEPTED, a state Studio Next can still walk back. The flow
 *   unblocks there, and says FINALIZED only once the transaction itself
 *   reports FINALIZED with a successful deciding execution.
 *
 *   A REFUSAL THAT HAS FINALIZED IS THE CHAIN'S LAST WORD. A write the
 *   contract refused never satisfies its predicate, so every few polls the
 *   transaction itself is read too, and a finalized refusal is reported as
 *   one instead of leaving the user at "pending".
 */
import type { TransactionFeeEstimate } from "genlayer-js/types";

import { isTransient, walletErrorMessage } from "./chain";
import { formatGen } from "./config";
import { getTransactionStatus, type TxFinalityView } from "./read";

function retryable(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "transient" in err) {
    const t = (err as { transient: unknown }).transient;
    if (typeof t === "boolean") return t;
  }
  return isTransient(err);
}

export type TxStage =
  | "idle"
  | "estimating" // simulating the write to size its fee deposit
  | "wallet" // waiting for the signature
  | "submitted" // signed and sent
  | "pending" // on chain, awaiting the state change
  | "accepted" // the record reflects it; not yet final
  | "confirmed" // the transaction reports FINALIZED and executed
  | "unresolved" // submitted, and we stopped waiting without an answer
  | "rejected" // the user declined
  | "failed";

/** Still in flight? "unresolved" is not: its control must become usable again. */
export function inFlight(stage: TxStage): boolean {
  return stage === "estimating" || stage === "wallet" || stage === "submitted" || stage === "pending";
}

/** Has the record caught up with what the user asked for? The gate for follow-up actions. */
export function stateVisible(stage: TxStage): boolean {
  return stage === "accepted" || stage === "confirmed";
}

export type TxProgress = {
  stage: TxStage;
  detail: string;
  hash?: string;
  /** For a terminal report, the track stage it belongs to. */
  at?: TxStage;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = any;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── fees ────────────────────────────────────────────────────────────────────

/** The smallest deposit a write is sent with: 0.001 GEN. A zero deposit always reverts. */
export const FEE_FLOOR_ATTO = 10n ** 15n;

export function floorFee(estimate: bigint): bigint {
  return estimate < FEE_FLOOR_ATTO ? FEE_FLOOR_ATTO : estimate;
}

export type TxFees = {
  distribution: TransactionFeeEstimate["distribution"];
  feeValue: bigint;
  messageAllocations?: TransactionFeeEstimate["messageAllocations"];
};

const SIMULATION_TIMEOUT_MS = 30_000;

/** A simulation the network dropped is asked this many times before the write is priced without it. */
export const SIMULATION_ATTEMPTS = 3;

class SimulationStalled extends Error {}

/**
 * Size the fee deposit. A deterministic write is SIMULATED first, which runs
 * the method and so surfaces a refusal before anything is signed. A write
 * whose method fetches the web or runs the panel (opening a record, an
 * independent source, adjudication) is sized with the plain estimate
 * instead: simulating it would run the fetch or a whole model round just to
 * price it. That plain estimate is the path AutoCourt's earlier worker used
 * for every write on Studio Next, and a simulation that stalls or fails for
 * a reason that is not the contract's falls back to it.
 *
 * A dropped connection is not such a reason: it says nothing about the
 * write, so the simulation is asked again first. Found live: one "fetch
 * failed" on the simulation of a stranger's seal sent that seal to the chain,
 * where the contract refused it; the refusal belonged before the wallet.
 */
async function estimateFees(
  client: Client,
  address: string,
  functionName: string,
  args: unknown[],
  simulate: boolean,
  retryMs: number,
): Promise<TxFees> {
  if (simulate) {
    for (let attempt = 1; attempt <= SIMULATION_ATTEMPTS; attempt++) {
      try {
        const est: TransactionFeeEstimate = await Promise.race([
          client.estimateTransactionFeesForWrite({ address: address as `0x${string}`, functionName, args, value: 0n }),
          sleep(SIMULATION_TIMEOUT_MS).then(() => {
            throw new SimulationStalled("the simulation did not answer");
          }),
        ]);
        return {
          distribution: est.distribution,
          feeValue: floorFee(BigInt(est.feeValue)),
          messageAllocations: est.messageAllocations,
        };
      } catch (err) {
        if (contractRefusal(err)) throw err;
        const dropped = !(err instanceof SimulationStalled) && isTransient(errorText(err));
        if (!dropped || attempt === SIMULATION_ATTEMPTS) break;
        await sleep(retryMs * attempt);
      }
    }
  }
  const est: TransactionFeeEstimate = await client.estimateTransactionFees();
  return { distribution: est.distribution, feeValue: floorFee(BigInt(est.feeValue)) };
}

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

/**
 * The contract's error taxonomy (contracts/autocourt_assessment.py). [EXPECTED]
 * is a business refusal and [EXTERNAL] a source that answered 4xx: both are
 * the write's last word. [TRANSIENT] is network noise and [LLM_ERROR] a model
 * that misbehaved: the same write can go through on the next attempt.
 */
const TAGS = ["[EXPECTED]", "[EXTERNAL]", "[TRANSIENT]", "[LLM_ERROR]"] as const;

export function passingFailure(sentence: string): boolean {
  return sentence.startsWith("[TRANSIENT]") || sentence.startsWith("[LLM_ERROR]");
}

function fromMarker(text: string): string | null {
  let at = -1;
  for (const tag of TAGS) {
    const i = text.indexOf(tag);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return null;
  return text.slice(at).split(/\r?\n/)[0]!.trim();
}

/**
 * The contract's own words for stopping a write, or null when the failure
 * was not the contract's. Measured on Studio Next: the fee simulation of a
 * refused write fails with JSON-RPC -32000 whose data.receipt.result is the
 * GenVM result as base64, one tag byte then the sentence. viem buries that
 * under `cause`, so the chain is walked.
 */
export function contractRefusal(err: unknown): string | null {
  let node: unknown = err;
  for (let depth = 0; depth < 6 && typeof node === "object" && node !== null; depth++) {
    const e = node as Record<string, unknown>;
    const data = e.data as { receipt?: Record<string, unknown> } | undefined;
    const receipt = data?.receipt;
    if (receipt && receipt.execution_result === "ERROR") {
      const text = decodeGenVmResult(receipt.result);
      return fromMarker(text) ?? (text ? `The contract refused this write: ${text}` : "The contract refused this write.");
    }
    node = e.cause;
  }
  return fromMarker(errorText(err));
}

/** base64 GenVM result → its text, minus the leading tag byte(s). */
export function decodeGenVmResult(b64: unknown): string {
  if (typeof b64 !== "string" || !b64) return "";
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    let i = 0;
    while (i < text.length && text.charCodeAt(i) < 0x20) i++;
    return text.slice(i).trim();
  } catch {
    return "";
  }
}

/** A refusal sentence, with its machine tag removed, for people to read. */
export function refusalForPeople(sentence: string): string {
  return sentence.replace(/^\[[A-Z_]+\]\s*/, "");
}

// ── the write ───────────────────────────────────────────────────────────────

export type WriteArgs = {
  client: Client;
  address: string;
  functionName: string;
  args: unknown[];
  /** "Has the record caught up?" Resolves true when the state is visible. */
  predicate: () => Promise<boolean>;
  onProgress?: (p: TxProgress) => void;
  /** How many predicate polls before giving up, 6s apart. A panel round takes minutes. */
  predicateTries?: number;
  finalityTries?: number;
  confirmedDetail?: string;
  txStatus?: (hash: string) => Promise<TxFinalityView>;
  pollMs?: number;
  /** Simulate before signing (deterministic writes); false sizes with the plain estimate. */
  simulate?: boolean;
};

/**
 * Size a write, submit it, confirm it by reading the record back, then prove
 * finality. Resolves with the hash once the STATE IS VISIBLE; the finality
 * watch keeps reporting through `onProgress` afterwards. Throws on refusal,
 * rejection or failure, and `onProgress` always ends on a terminal stage.
 */
export async function writeAndConfirm({
  client,
  address,
  functionName,
  args,
  predicate,
  onProgress,
  predicateTries = 30,
  finalityTries = 20,
  confirmedDetail = "Finalized on chain.",
  txStatus = getTransactionStatus,
  pollMs = 6_000,
  simulate = true,
}: WriteArgs): Promise<string> {
  const report = (p: TxProgress) => onProgress?.(p);

  if (!client) {
    const detail = "Connect a wallet first.";
    report({ stage: "failed", detail, at: "estimating" });
    throw new Error(detail);
  }

  report({ stage: "estimating", detail: "Simulating the write to size its fee deposit…" });

  let fees: TxFees;
  try {
    fees = await estimateFees(client, address, functionName, args, simulate, Math.min(pollMs, 1_000));
  } catch (err) {
    const refusal = contractRefusal(err);
    const detail = refusal
      ? passingFailure(refusal)
        ? `The simulation hit a passing failure, so nothing was sent: ${refusalForPeople(refusal)}. Retrying usually works.`
        : `The contract refused this, so nothing was sent: ${refusalForPeople(refusal)}.`
      : isTransient(errorText(err))
        ? "Studio Next could not be reached to size the fee deposit, so nothing was sent. Retrying usually works."
        : /insufficient|balance|funds/i.test(errorText(err))
          ? "This wallet does not hold enough GEN for the fee deposit. Get test GEN, then try again."
          : `The fee estimate failed, so nothing was sent: ${errorText(err).slice(0, 160)}`;
    report({ stage: "failed", detail, at: "estimating" });
    throw new Error(detail, { cause: err });
  }

  report({
    stage: "wallet",
    detail: `Confirm in your wallet. Fee deposit ${formatGen(fees.feeValue)} GEN, mostly refunded.`,
  });

  let hash = "";
  try {
    const res = await client.writeContract({
      address: address as `0x${string}`,
      functionName,
      args,
      value: 0n,
      fees,
    });
    hash = typeof res === "string" ? res : (res?.transactionHash ?? res?.hash ?? "");
  } catch (err) {
    const e = err as { code?: number };
    const detail = /insufficient|balance|funds/i.test(errorText(err))
      ? "This wallet does not hold enough GEN for the fee deposit. Get test GEN, then try again."
      : walletErrorMessage(err);
    report({ stage: e?.code === 4001 ? "rejected" : "failed", detail, at: "wallet" });
    throw err;
  }

  report({ stage: "submitted", detail: "Sent to Studio Next.", hash });
  report({ stage: "pending", detail: "Waiting for the record to reflect it…", hash });

  let landed = false;
  for (let i = 0; i < predicateTries && !landed; i++) {
    await sleep(pollMs);
    try {
      landed = await predicate();
    } catch (err) {
      if (!retryable(err)) {
        report({ stage: "failed", detail: "The chain could not be read back to confirm this.", hash, at: "pending" });
        throw err;
      }
    }
    if (!landed && i % 3 === 2) {
      let refused = false;
      try {
        const v = await txStatus(hash);
        refused = (v.finalized && v.executed === "ERROR") || v.statusName === "CANCELED";
        // UNDETERMINED is terminal: the rounds ran out without agreement.
        // (A *_TIMEOUT status is not; the chain still rotates from it.)
        if (!refused && v.statusName === "UNDETERMINED") {
          const detail =
            "The validators did not reach agreement on this transaction, so nothing was recorded. Trying again starts a fresh round.";
          report({ stage: "failed", detail, hash, at: "pending" });
          throw new Error(detail);
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("The validators did not")) throw err;
        // A failed status read says nothing about the write.
      }
      if (refused) {
        const detail = "Studio Next finalized this transaction as refused: the contract did not accept it, and nothing changed.";
        report({ stage: "failed", detail, hash, at: "pending" });
        throw new Error(detail);
      }
    }
  }

  if (!landed) {
    report({
      stage: "unresolved",
      detail:
        "Submitted, and the record does not show it yet. It is not lost and may still land. Nothing here is polling any more, so refresh in a moment to see where it got to.",
      hash,
    });
    return hash;
  }

  report({
    stage: "accepted",
    detail: "The record reflects it. Studio Next has accepted the transaction, and finality usually follows within a minute.",
    hash,
  });
  void watchFinality(hash, report, confirmedDetail, finalityTries, txStatus, pollMs);
  return hash;
}

async function watchFinality(
  hash: string,
  report: (p: TxProgress) => void,
  confirmedDetail: string,
  finalityTries: number,
  txStatus: (hash: string) => Promise<TxFinalityView>,
  pollMs: number,
): Promise<void> {
  for (let i = 0; i < finalityTries; i++) {
    await sleep(pollMs);
    let v: TxFinalityView | null = null;
    try {
      v = await txStatus(hash);
    } catch {
      // Answered by the next poll.
    }
    if (!v) continue;
    if (v.finalized && v.executed === "SUCCESS") {
      report({ stage: "confirmed", detail: confirmedDetail, hash });
      return;
    }
    if ((v.finalized && v.executed === "ERROR") || v.statusName === "CANCELED") {
      report({
        stage: "confirmed",
        detail: `${confirmedDetail} This transaction itself finalized without effect: another transaction produced the same state first.`,
        hash,
      });
      return;
    }
  }
  report({
    stage: "accepted",
    detail:
      "The record reflects this, and Studio Next has not reported it finalized yet. That step almost always follows on its own; refresh in a minute.",
    hash,
  });
}

export const STAGE_LABEL: Record<TxStage, string> = {
  idle: "Ready",
  estimating: "Estimating fee",
  wallet: "Confirm in wallet",
  submitted: "Submitted",
  pending: "Pending",
  accepted: "Accepted",
  confirmed: "Finalized",
  unresolved: "Not yet visible",
  rejected: "Declined",
  failed: "Failed",
};

export const STAGE_TRACK: TxStage[] = ["estimating", "wallet", "submitted", "pending", "accepted", "confirmed"];

export function stageClass(step: TxStage, current: TxStage, at?: TxStage): string {
  if (current === "failed" || current === "rejected") {
    const failAt = STAGE_TRACK.indexOf(at ?? "wallet");
    const me = STAGE_TRACK.indexOf(step);
    if (me < 0 || failAt < 0) return "txstep";
    if (me < failAt) return "txstep done";
    return me === failAt ? "txstep fail" : "txstep";
  }
  if (current === "unresolved") {
    return step === "accepted" || step === "confirmed" ? "txstep" : "txstep done";
  }
  const cur = STAGE_TRACK.indexOf(current);
  const me = STAGE_TRACK.indexOf(step);
  if (cur < 0 || me < 0) return "txstep";
  if (me < cur) return "txstep done";
  if (me === cur) return "txstep on";
  return "txstep";
}
