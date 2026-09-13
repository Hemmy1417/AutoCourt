/**
 * Post-drain effect recording: DONE jobs update the rows their outcome
 * proves. Separate from worker-core so the drainer stays a pure
 * queue-to-chain bridge and every DB effect lives in one place.
 *
 * CREATE resolves the on-chain id by matching the record the contract
 * stores (VIN + seller + claims), scanning back from the newest id —
 * deterministic, race-tolerant, and never trusts a locally-guessed id.
 */

import { prisma } from "@autocourt/db";
import { AutoCourtChain } from "@autocourt/genlayer-client";

export interface EffectsResult {
  linked: number;
  runsRecorded: number;
  failuresRecorded: number;
}

async function resolveOnChainId(
  chainClient: AutoCourtChain,
  vin: string,
  sellerAccount: string,
): Promise<string | null> {
  const stats = await chainClient.getStats();
  const total = Number(stats["assessments"] ?? 0);
  // Ids REPEAT across contracts — a redeploy restarts the numbering — so
  // "already taken" is only meaningful within one contract. Counting a
  // row from a superseded deployment as taken makes a legitimately
  // created record unlinkable, and every job addressing it waits forever.
  const taken = new Set(
    (
      await prisma.assessment.findMany({
        where: {
          onChainId: { not: null },
          contractAddress: chainClient.address,
        },
        select: { onChainId: true },
      })
    ).map((a) => a.onChainId),
  );
  for (let n = total; n > Math.max(0, total - 8); n--) {
    const candidate = `ac-${String(n).padStart(6, "0")}`;
    if (taken.has(candidate)) continue;
    try {
      const a = await chainClient.getAssessment(candidate);
      if (a["vin"] === vin && a["seller_account"] === sellerAccount) {
        return candidate;
      }
    } catch {
      // unknown id — keep scanning
    }
  }
  return null;
}

export async function recordJobEffects(
  chainClient: AutoCourtChain,
): Promise<EffectsResult> {
  const result: EffectsResult = { linked: 0, runsRecorded: 0, failuresRecorded: 0 };

  // 1. CREATE jobs that finished: link the on-chain id, then inject it
  //    into every later job payload for this assessment.
  const doneCreates = await prisma.job.findMany({
    where: { kind: "CREATE", state: "DONE" },
    include: {
      assessment: {
        include: { vehicle: { include: { seller: true } } },
      },
    },
  });
  for (const job of doneCreates) {
    if (job.assessment.onChainId) continue;
    const onChainId = await resolveOnChainId(
      chainClient,
      job.assessment.vehicle.vin,
      job.assessment.vehicle.seller.walletAddress,
    );
    if (!onChainId) continue;
    // Cache what the registry told every validator at creation. The chain
    // copy decides; this is the index the screens read.
    let identityStatus = "";
    let registryJson = "{}";
    try {
      const onChain = await chainClient.getAssessment(onChainId);
      identityStatus = String(onChain["identity_status"] ?? "");
      registryJson = JSON.stringify(onChain["registry_fields"] ?? {});
    } catch {
      // The link still stands; the screens fall back to reading the chain.
    }
    await prisma.assessment.update({
      where: { id: job.assessmentId },
      data: {
        onChainId,
        identityStatus,
        registryJson,
        contractAddress: chainClient.address,
      },
    });
    result.linked += 1;
  }

  // 2. Every PENDING job on a linked assessment gets the on-chain id in
  //    its payload (jobs enqueued before CREATE resolved lacked it).
  const pending = await prisma.job.findMany({
    where: { state: "PENDING" },
    include: { assessment: true },
  });
  for (const job of pending) {
    if (!job.assessment.onChainId) continue;
    const payload = JSON.parse(job.payloadJson || "{}");
    if (!payload.onChainId) {
      payload.onChainId = job.assessment.onChainId;
      await prisma.job.update({
        where: { id: job.id },
        data: { payloadJson: JSON.stringify(payload) },
      });
    }
  }

  // 3. Evidence submissions that finished: stamp the tx hash on the item.
  //    ANCHOR items additionally get their REAL hashes and status read
  //    back from the chain — the contract fetched those bytes itself and
  //    normalized them, so only it knows what it stored. Until this
  //    lands, the row says PENDING_ENTRY and the packet cannot be sealed
  //    over a hash the app merely guessed.
  const doneAnchors = await prisma.job.findMany({
    where: { kind: "SUBMIT_ANCHOR", state: "DONE", txHash: { not: null } },
    include: { assessment: true },
  });
  for (const job of doneAnchors) {
    const payload = JSON.parse(job.payloadJson || "{}");
    const evidenceId = JSON.parse(payload.itemJson ?? "{}").evidence_id;
    if (!evidenceId || !job.assessment.onChainId) continue;
    const row = await prisma.evidenceItem.findFirst({
      where: { assessmentId: job.assessmentId, evidenceId },
    });
    if (!row || row.status !== "PENDING_ENTRY") continue;
    try {
      const stored = await chainClient.getItemText(
        job.assessment.onChainId,
        evidenceId,
      );
      await prisma.evidenceItem.update({
        where: { id: row.id },
        data: {
          status: String(stored["status"] ?? "SOURCE_UNAVAILABLE"),
          fileSha256: String(stored["file_sha256"] ?? row.fileSha256),
          textSha256: String(stored["text_sha256"] ?? row.textSha256),
          extractorVersion: String(
            stored["extractor_version"] ?? row.extractorVersion,
          ),
          onChainTxHash: job.txHash,
          extraction: {
            update: {
              status:
                String(stored["status"]) === "EXTRACTED"
                  ? "EXTRACTED"
                  : "UNAVAILABLE",
              normalizedText: String(stored["text"] ?? ""),
            },
          },
        },
      });
    } catch {
      // Leave it PENDING_ENTRY; the next drain retries the read.
    }
  }

  const doneEvidence = await prisma.job.findMany({
    where: {
      kind: { in: ["SUBMIT_EVIDENCE", "SUBMIT_APPEAL_EVIDENCE"] },
      state: "DONE",
      txHash: { not: null },
    },
  });
  for (const job of doneEvidence) {
    const payload = JSON.parse(job.payloadJson || "{}");
    const evidenceId = JSON.parse(payload.itemJson ?? "{}").evidence_id;
    if (!evidenceId) continue;
    await prisma.evidenceItem.updateMany({
      where: {
        assessmentId: job.assessmentId,
        evidenceId,
        onChainTxHash: null,
      },
      data: { onChainTxHash: job.txHash },
    });
  }

  // 4. Adjudications: DONE → cache the standing verdict + state; FAILED →
  //    record the attempt honestly (REJECTED when consensus refused with
  //    a reason, FAILED otherwise) and surface the retry path.
  const adjJobs = await prisma.job.findMany({
    where: {
      kind: { in: ["ADJUDICATE", "READJUDICATE"] },
      state: { in: ["DONE", "FAILED"] },
    },
    include: { assessment: true },
  });
  for (const job of adjJobs) {
    const already = job.txHash
      ? await prisma.adjudicationRun.findFirst({ where: { txHash: job.txHash } })
      : null;
    if (already) continue;
    const kind = job.kind === "ADJUDICATE" ? "ADJUDICATION" : "RE_ADJUDICATION";
    if (job.state === "DONE" && job.assessment.onChainId) {
      const verdict = await chainClient.getVerdict(job.assessment.onChainId);
      const runNumber = Number(verdict["standing_run"] ?? 0);
      await prisma.adjudicationRun.create({
        data: {
          assessmentId: job.assessmentId,
          runNumber,
          status: "SUCCESS",
          kind,
          packetVersion: job.assessment.packetVersion,
          txHash: job.txHash,
          reportJson: JSON.stringify(verdict),
        },
      });
      await prisma.assessment.update({
        where: { id: job.assessmentId },
        data: { state: "ADJUDICATED" },
      });
      if (kind === "RE_ADJUDICATION") {
        await prisma.appeal.updateMany({
          where: { assessmentId: job.assessmentId, runNumber: null },
          data: { runNumber, txHash: job.txHash },
        });
      }
      result.runsRecorded += 1;
    } else if (job.state === "FAILED") {
      const refused = job.lastError.startsWith("[");
      await prisma.adjudicationRun.create({
        data: {
          assessmentId: job.assessmentId,
          runNumber: 0,
          status: refused ? "REJECTED" : "FAILED",
          kind,
          packetVersion: job.assessment.packetVersion,
          txHash: job.txHash,
          errorText: job.lastError,
        },
      });
      await prisma.assessment.update({
        where: { id: job.assessmentId },
        data: { state: "FAILED" },
      });
      result.failuresRecorded += 1;
    }
  }

  // 5. SEAL done → SUBMITTED assessments become ready to adjudicate;
  //    keep the app state honest.
  const doneSeals = await prisma.job.findMany({
    where: { kind: "SEAL", state: "DONE" },
    include: { assessment: true },
  });
  for (const job of doneSeals) {
    if (job.assessment.state === "SUBMITTED") continue;
    if (job.assessment.state === "DRAFT") {
      await prisma.assessment.update({
        where: { id: job.assessmentId },
        data: { state: "SUBMITTED" },
      });
    }
  }

  return result;
}
