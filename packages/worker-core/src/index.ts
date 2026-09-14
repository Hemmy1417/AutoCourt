/**
 * The job drainer: PENDING rows become chain transactions under a LEASE,
 * so a dead invocation cannot strand an assessment in PROCESSING — the
 * lease expires and the next drain picks the job up (S26: every
 * non-terminal state has a named mover; here the mover is apps/worker or
 * a platform cron hitting the authenticated drain route).
 *
 * Recovery discipline: a job that already carries a txHash NEVER submits
 * again — it polls that hash and records what the chain says. A lost
 * response is not a refusal.
 */

import { prisma } from "@autocourt/db";
import { AutoCourtChain, type TxStatus } from "@autocourt/genlayer-client";

const LEASE_MS = 3 * 60_000;

export interface DrainResult {
  drained: number;
  succeeded: number;
  failed: number;
  stillPending: number;
}

export interface WorkerDeps {
  chain: AutoCourtChain;
  now?: () => Date;
}

type JobRow = {
  id: string;
  assessmentId: string;
  kind: string;
  payloadJson: string;
  attempts: number;
  maxAttempts: number;
  txHash: string | null;
  createdAt: Date;
};

/** Every kind except CREATE addresses the on-chain record. */
const NEEDS_ON_CHAIN_ID = new Set([
  "SUBMIT_EVIDENCE",
  "SUBMIT_ANCHOR",
  "RECORD_DISPUTE",
  "SEAL",
  "SUBMIT_APPEAL_EVIDENCE",
  "ADJUDICATE",
  "READJUDICATE",
]);

/**
 * A judgment that ends without a verdict is re-run by the PARTIES, never
 * by the queue (S26): a retry is their call, costs a panel round, and is
 * recorded as its own attempt with its own hash.
 */
const JUDGMENTS = new Set(["ADJUDICATE", "READJUDICATE"]);

/**
 * Writes that depend on nothing but the record existing (which the
 * on-chain-id wait below already guarantees). A buyer's dispute queued
 * while an adjudication is in flight must not be lost because that
 * adjudication failed, and a refused dispute must not fail a seal.
 */
const INDEPENDENT = ["RECORD_DISPUTE"];

/** The outcomes after which a transaction can no longer land. */
const TERMINAL = new Set(["FINALIZED", "CANCELED", "UNDETERMINED"]);

/** Queue order: creation time, with the id breaking a same-millisecond tie. */
const QUEUE_ORDER = [{ createdAt: "asc" as const }, { id: "asc" as const }];
const queuedBefore = (job: JobRow) => [
  { createdAt: { lt: job.createdAt } },
  { createdAt: job.createdAt, id: { lt: job.id } },
];
const queuedAfter = (job: JobRow) => [
  { createdAt: { gt: job.createdAt } },
  { createdAt: job.createdAt, id: { gt: job.id } },
];

/**
 * Fail a job, and with it every step queued behind it for the same record:
 * those steps would address a record in a state it never reached.
 *
 * The cascade happens HERE, once, rather than as a check each later job
 * makes against "any earlier failure". That check could never tell an
 * abandoned step from an old attempt that had already ended — so one
 * failure failed every job the record would ever queue, including the
 * retry the adjudicate route offers and every appeal after it. Jobs queued
 * after this failure is written are new attempts, made knowing about it.
 *
 * A job behind that already carries a hash is on the chain; it is left to
 * be polled, because a lost response is not a refusal.
 */
async function failJob(
  job: JobRow,
  data: { lastError: string; txHash?: string | null; countAttempt: boolean },
): Promise<void> {
  const failed = prisma.job.update({
    where: { id: job.id },
    data: {
      state: "FAILED",
      lockedUntil: null,
      lastError: data.lastError,
      ...(data.txHash !== undefined ? { txHash: data.txHash } : {}),
      ...(data.countAttempt ? { attempts: { increment: 1 } } : {}),
    },
  });
  if (INDEPENDENT.includes(job.kind)) {
    await failed;
    return;
  }
  await prisma.$transaction([
    failed,
    prisma.job.updateMany({
      where: {
        assessmentId: job.assessmentId,
        state: "PENDING",
        txHash: null,
        kind: { notIn: INDEPENDENT },
        OR: queuedAfter(job),
      },
      data: {
        state: "FAILED",
        lockedUntil: null,
        lastError: `an earlier step failed (${job.kind}), so this one cannot run`,
      },
    }),
  ]);
}

function writeFor(chain: AutoCourtChain, job: JobRow) {
  const p = JSON.parse(job.payloadJson || "{}");
  switch (job.kind) {
    case "CREATE":
      return chain.createAssessment(p.vehicleJson, p.claimsJson);
    case "SUBMIT_EVIDENCE":
      return chain.submitEvidenceText(p.onChainId, p.itemJson);
    case "SUBMIT_ANCHOR":
      return chain.submitAnchorItem(p.onChainId, p.itemJson);
    case "RECORD_DISPUTE":
      return chain.recordDispute(
        p.onChainId,
        p.account,
        p.claimIdsJson,
        p.note ?? "",
      );
    case "SEAL":
      return chain.sealAssessment(p.onChainId, p.manifestRoot);
    case "SUBMIT_APPEAL_EVIDENCE":
      return chain.submitAppealEvidence(p.onChainId, p.itemJson);
    case "ADJUDICATE":
      return chain.adjudicate(p.onChainId);
    case "READJUDICATE":
      return chain.readjudicate(p.onChainId, p.appellantAccount, p.grounds);
    default:
      throw new Error(`unknown job kind ${job.kind}`);
  }
}

async function recordOutcome(
  job: JobRow,
  txHash: string,
  status: TxStatus,
): Promise<"done" | "failed" | "pending"> {
  if (status.status === "FINALIZED" && status.leaderResult === "SUCCESS") {
    await prisma.job.update({
      where: { id: job.id },
      data: { state: "DONE", txHash, lastError: "" },
    });
    return "done";
  }
  if (!TERMINAL.has(status.status)) {
    // PENDING, ACCEPTED, or an answer we could not read: the transaction
    // can still land. Keep the hash; the next drain polls it. Never
    // resubmit.
    await prisma.job.update({
      where: { id: job.id },
      data: { state: "PENDING", txHash, lockedUntil: null },
    });
    return "pending";
  }
  // CANCELED / UNDETERMINED / leader error: this ATTEMPT is over. The
  // refusal sentence (if any) is the record.
  const error =
    status.refusalText ??
    `${status.status}${status.leaderResult ? ` leader=${status.leaderResult}` : ""}`;
  const exhausted = job.attempts + 1 >= job.maxAttempts;
  const refused = Boolean(status.refusalText?.startsWith("[EXPECTED]"));
  if (refused || exhausted || JUDGMENTS.has(job.kind)) {
    await failJob(job, { lastError: error, txHash, countAttempt: true });
    return "failed";
  }
  // Retry as a NEW attempt. Keeping the hash would only re-poll a
  // transaction that has already ended, so the "retry" would read the same
  // failure until the attempts ran out — a write that missed consensus once
  // was never actually sent again. The ended attempt stays in the error.
  await prisma.job.update({
    where: { id: job.id },
    data: {
      state: "PENDING",
      attempts: { increment: 1 },
      txHash: null,
      lastError: `${error} (attempt ${job.attempts + 1}, tx ${txHash})`,
      lockedUntil: null,
    },
  });
  return "failed";
}

/**
 * One drain pass. Callable from the long-lived worker loop or from the
 * authenticated serverless drain route — identical behavior.
 */
export async function runPendingJobs(deps: WorkerDeps): Promise<DrainResult> {
  const now = deps.now?.() ?? new Date();
  const result: DrainResult = {
    drained: 0,
    succeeded: 0,
    failed: 0,
    stillPending: 0,
  };

  // Lease atomically: only rows whose lease is free or expired.
  const candidates = await prisma.job.findMany({
    where: {
      state: "PENDING",
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    orderBy: QUEUE_ORDER,
    // Generous, because jobs still waiting on their CREATE are skipped
    // without being worked: a small window would let a few waiters crowd
    // out every job that could actually run.
    take: 25,
  });

  for (const candidate of candidates) {
    const leased = await prisma.job.updateMany({
      where: {
        id: candidate.id,
        state: "PENDING",
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      data: { lockedUntil: new Date(now.getTime() + LEASE_MS) },
    });
    if (leased.count === 0) continue; // someone else took it
    const job = candidate as unknown as JobRow;

    // JOBS FOR ONE ASSESSMENT ARE A SEQUENCE, not a set. Sealing depends
    // on the evidence writes before it; adjudicating depends on the seal.
    // The lease stops one job running twice, but says nothing about
    // ORDER — so a job left in flight (accepted, not yet finalized) used
    // to let the next one overtake it, and a SEAL reached the contract
    // before the evidence it was meant to cover. The contract refused it
    // correctly: "sealing requires at least one evidence item".
    //
    // Only UNFINISHED steps hold a job back. A failed one has already
    // failed everything that was queued behind it (see failJob).
    const unfinished = await prisma.job.findFirst({
      where: {
        assessmentId: job.assessmentId,
        state: "PENDING",
        OR: queuedBefore(job),
      },
      select: { id: true },
    });
    if (unfinished) {
      await prisma.job.update({
        where: { id: job.id },
        data: { lockedUntil: null },
      });
      result.stillPending += 1;
      continue;
    }

    // A job that addresses the record must know its on-chain id. Jobs
    // enqueued alongside CREATE lack it until the CREATE effect links
    // the assessment — resolve it from the row at drain time, and if it
    // is still unknown, release the lease and wait for the next pass
    // rather than submitting a write the contract can only crash on.
    if (NEEDS_ON_CHAIN_ID.has(job.kind)) {
      const payload = JSON.parse(job.payloadJson || "{}");
      if (!payload.onChainId) {
        const assessment = await prisma.assessment.findUnique({
          where: { id: job.assessmentId },
          select: { onChainId: true },
        });
        if (!assessment?.onChainId) {
          // Waiting is only reasonable while a CREATE is still coming. A
          // job whose assessment has no CREATE job at all can never be
          // satisfied — it would release its lease on every pass forever,
          // and enough of them would starve the queue. Fail it loudly
          // instead of spinning.
          const creating = await prisma.job.count({
            where: {
              assessmentId: job.assessmentId,
              kind: "CREATE",
              state: { in: ["PENDING", "DONE"] },
            },
          });
          if (creating) {
            await prisma.job.update({
              where: { id: job.id },
              data: { lockedUntil: null },
            });
            result.stillPending += 1;
          } else {
            await failJob(job, {
              lastError:
                "the assessment was never created on chain, so this " +
                "write has nothing to address",
              countAttempt: false,
            });
            result.failed += 1;
          }
          continue;
        }
        payload.onChainId = assessment.onChainId;
        job.payloadJson = JSON.stringify(payload);
        await prisma.job.update({
          where: { id: job.id },
          data: { payloadJson: job.payloadJson },
        });
      }
    }
    result.drained += 1;

    let txHash = job.txHash;
    try {
      if (!txHash) {
        // First (or fresh) attempt: submit ONCE, persist the hash before
        // waiting on anything.
        const w = await writeFor(deps.chain, job);
        txHash = w.txHash;
        await prisma.job.update({
          where: { id: job.id },
          data: { txHash },
        });
      }
      const status = await deps.chain.waitFinality(txHash);
      const outcome = await recordOutcome(job, txHash, status);
      if (outcome === "done") result.succeeded += 1;
      else if (outcome === "failed") result.failed += 1;
      else result.stillPending += 1;
    } catch (e) {
      const message = String((e as Error)?.message ?? e).slice(0, 500);
      if (txHash) {
        // The write IS on the chain; only reading its outcome failed.
        // That is not an attempt, and three unreadable polls must not fail
        // a transaction that may well have landed. Keep the hash (again, in
        // case persisting it is what failed) and poll next pass.
        await prisma.job.update({
          where: { id: job.id },
          data: { txHash, lockedUntil: null, lastError: `polling: ${message}` },
        });
        result.stillPending += 1;
        continue;
      }
      // Submission itself failed BEFORE a hash existed — nothing reached
      // the chain, so a retry is safe, bounded by maxAttempts.
      if (job.attempts + 1 >= job.maxAttempts) {
        await failJob(job, { lastError: message, countAttempt: true });
      } else {
        await prisma.job.update({
          where: { id: job.id },
          data: {
            state: "PENDING",
            attempts: { increment: 1 },
            lastError: message,
            lockedUntil: null,
          },
        });
      }
      result.failed += 1;
    }
  }
  return result;
}

export { recordJobEffects, type EffectsResult } from "./effects.js";
