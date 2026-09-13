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
  if (status.status === "PENDING" || status.status === "ACCEPTED") {
    // Keep the hash; the next drain polls it. Never resubmit.
    await prisma.job.update({
      where: { id: job.id },
      data: { state: "PENDING", txHash, lockedUntil: null },
    });
    return "pending";
  }
  // CANCELED / UNDETERMINED / leader error: this ATTEMPT is over. The
  // refusal sentence (if any) is the record; retry is a new attempt with
  // its own hash, bounded by maxAttempts.
  const error =
    status.refusalText ??
    `${status.status}${status.leaderResult ? ` leader=${status.leaderResult}` : ""}`;
  const exhausted = job.attempts + 1 >= job.maxAttempts;
  const refused = Boolean(status.refusalText?.startsWith("[EXPECTED]"));
  await prisma.job.update({
    where: { id: job.id },
    data: {
      state: exhausted || refused ? "FAILED" : "PENDING",
      attempts: { increment: 1 },
      txHash,
      lastError: error,
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
    orderBy: { createdAt: "asc" },
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
    const earlier = await prisma.job.findMany({
      where: {
        assessmentId: job.assessmentId,
        createdAt: { lt: candidate.createdAt },
        state: { not: "DONE" },
      },
      select: { state: true, kind: true },
    });
    if (earlier.length > 0) {
      const failedFirst = earlier.find((e) => e.state === "FAILED");
      await prisma.job.update({
        where: { id: job.id },
        data: failedFirst
          ? {
              // Everything after a failed step would address a record in
              // a state it never reached.
              state: "FAILED",
              lockedUntil: null,
              lastError: `an earlier step failed (${failedFirst.kind}), so this one cannot run`,
            }
          : { lockedUntil: null },
      });
      if (failedFirst) result.failed += 1;
      else result.stillPending += 1;
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
          await prisma.job.update({
            where: { id: job.id },
            data: creating
              ? { lockedUntil: null }
              : {
                  state: "FAILED",
                  lockedUntil: null,
                  lastError:
                    "the assessment was never created on chain, so this " +
                    "write has nothing to address",
                },
          });
          if (creating) result.stillPending += 1;
          else result.failed += 1;
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

    try {
      let txHash = job.txHash;
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
      // Submission itself failed BEFORE a hash existed — safe to count
      // the attempt and retry bounded; with a hash, the branch above
      // already persisted it and the next drain polls.
      const exhausted = job.attempts + 1 >= job.maxAttempts;
      await prisma.job.update({
        where: { id: job.id },
        data: {
          state: exhausted ? "FAILED" : "PENDING",
          attempts: { increment: 1 },
          lastError: String((e as Error)?.message ?? e).slice(0, 500),
          lockedUntil: null,
        },
      });
      result.failed += 1;
    }
  }
  return result;
}

export { recordJobEffects, type EffectsResult } from "./effects.js";
