/**
 * Domain services shared by the route handlers: role resolution, evidence
 * intake, job enqueueing, and the audit trail. Route files stay thin.
 */

import { prisma, type PrismaClient } from "@autocourt/db";
import {
  extractEvidence,
  EXTRACTOR_VERSION,
  LocalDiskStorage,
  mimeFor,
  normalizeText,
  sha256Bytes,
  sha256Text,
  applyRedactions,
  type RedactionSpan,
} from "@autocourt/evidence";

import { badRequest, conflict, forbidden, notFound } from "./errors.js";

/** The client, or a transaction inside it: helpers that write take either. */
export type Db = Pick<
  PrismaClient,
  "assessment" | "job" | "appeal" | "evidenceItem" | "claimDispute"
>;

const storage = new LocalDiskStorage(
  process.env.EVIDENCE_ROOT ?? "var/evidence",
);

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export type Role = "SELLER" | "BUYER";

export interface AccessResult {
  assessment: NonNullable<
    Awaited<ReturnType<typeof loadAssessment>>
  >;
  role: Role;
}

export async function loadAssessment(id: string, db: Db = prisma) {
  return db.assessment.findUnique({
    where: { id },
    include: {
      vehicle: {
        include: {
          seller: true,
          claims: {
            include: {
              disputes: {
                include: {
                  disputer: { select: { walletAddress: true } },
                },
              },
            },
          },
        },
      },
      evidenceItems: {
        include: {
          extraction: true,
          observations: true,
          uploader: { select: { walletAddress: true } },
        },
      },
      runs: { orderBy: { createdAt: "desc" } },
    },
  });
}

/** Seller on vehicles they created; buyer on assessments shared with them. */
export async function requireAccess(
  assessmentId: string,
  userId: string,
): Promise<AccessResult> {
  const assessment = await loadAssessment(assessmentId);
  if (!assessment) throw notFound("assessment");
  if (assessment.vehicle.sellerId === userId) {
    return { assessment, role: "SELLER" };
  }
  const buyer = await prisma.buyerAccess.findUnique({
    where: { assessmentId_userId: { assessmentId, userId } },
  });
  if (buyer) return { assessment, role: "BUYER" };
  throw forbidden();
}

export async function audit(
  actorId: string | null,
  kind: string,
  detail: Record<string, unknown>,
  evidenceItemId?: string,
): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actorId,
      kind,
      detailJson: JSON.stringify(detail),
      ...(evidenceItemId ? { evidenceItemId } : {}),
    },
  });
}

/**
 * Evidence intake: sniff by magic bytes, hash, store under the hash,
 * extract honestly, normalize. Redaction and consent come LATER and
 * before any packet — this only creates the private, app-side record.
 */
export async function intakeEvidence(opts: {
  assessmentId: string;
  uploaderId: string;
  uploaderRole: Role;
  declaredClass: string;
  declaredLabel: string;
  bytes: Uint8Array;
  captureDate: string;
}) {
  if (opts.bytes.length === 0) throw badRequest("empty file");
  if (opts.bytes.length > MAX_UPLOAD_BYTES)
    throw badRequest(`file exceeds ${MAX_UPLOAD_BYTES} bytes`);

  const fileSha256 = await storage.put(opts.bytes);
  const extraction = await extractEvidence(opts.bytes);
  const normalized = extraction.normalizedText;

  const count = await prisma.evidenceItem.count({
    where: { assessmentId: opts.assessmentId },
  });
  const evidenceId = `E-${String(count + 1).padStart(3, "0")}`;

  const item = await prisma.evidenceItem.create({
    data: {
      assessmentId: opts.assessmentId,
      evidenceId,
      uploaderId: opts.uploaderId,
      uploaderRole: opts.uploaderRole,
      declaredClass: opts.declaredClass,
      declaredLabel: opts.declaredLabel,
      mimeType: mimeFor(extraction.kind),
      fileSha256,
      textSha256: sha256Text(normalized),
      extractorVersion: EXTRACTOR_VERSION,
      status: extraction.status === "EXTRACTED" ? "EXTRACTED" : "UNEXTRACTED",
      captureDate: opts.captureDate,
      extraction: {
        create: {
          status: extraction.status,
          normalizedText: normalized,
        },
      },
    },
    include: { extraction: true },
  });
  await audit(opts.uploaderId, "EVIDENCE_UPLOADED", {
    evidenceId,
    fileSha256,
    kind: extraction.kind,
    extracted: extraction.status,
  }, item.id);
  return item;
}

/** Re-normalizes with redactions applied; refuses after consent. */
export async function redactEvidence(
  itemRowId: string,
  actorId: string,
  spans: RedactionSpan[],
) {
  const item = await prisma.evidenceItem.findUnique({
    where: { id: itemRowId },
    include: { extraction: true },
  });
  if (!item || !item.extraction) throw notFound("evidence item");
  if (item.consentedAt) {
    throw badRequest(
      "this item is already consented for a packet; redaction must " +
        "happen before submission and is impossible after",
    );
  }
  if (item.status !== "EXTRACTED") throw badRequest("nothing to redact");
  // Always re-derive from the ORIGINAL bytes so spans compose sanely.
  const original = await storage.get(item.fileSha256);
  const fresh = await extractEvidence(original);
  const redacted = normalizeText(applyRedactions(fresh.normalizedText, spans));
  const updated = await prisma.evidenceItem.update({
    where: { id: itemRowId },
    data: {
      textSha256: sha256Text(redacted),
      redactionStatus: spans.length > 0 ? "REDACTED" : "NONE",
      extraction: { update: { normalizedText: redacted } },
    },
    include: { extraction: true },
  });
  await audit(actorId, "EVIDENCE_REDACTED", {
    evidenceId: item.evidenceId,
    spanCount: spans.length,
  }, item.id);
  return updated;
}

export async function enqueueJob(
  assessmentId: string,
  kind: string,
  payload: Record<string, unknown>,
  db: Db = prisma,
): Promise<string> {
  const job = await db.job.create({
    data: {
      assessmentId,
      kind,
      payloadJson: JSON.stringify(payload),
    },
  });
  return job.id;
}

export function readOriginal(fileSha256: string): Promise<Uint8Array> {
  return storage.get(fileSha256);
}

/**
 * Make sure the assessment exists ON CHAIN before anything addresses it.
 *
 * Submission used to be the only thing that enqueued CREATE, which meant
 * an independent source added beforehand queued a write against a record
 * the contract had never heard of — its job would wait for an on-chain
 * id forever. Anything that needs the record to exist calls this first;
 * it is idempotent — but only when called under the record's lock (a claim
 * or withRecordLock). Two unlocked calls can both find no CREATE, and the
 * record goes on chain twice.
 */
export async function ensureCreateJob(
  assessmentId: string,
  db: Db = prisma,
): Promise<void> {
  const a = await db.assessment.findUnique({
    where: { id: assessmentId },
    include: { vehicle: { include: { claims: true, seller: true } } },
  });
  if (!a || a.onChainId) return;
  const already = await db.job.findFirst({
    where: { assessmentId, kind: "CREATE", state: { in: ["PENDING", "DONE"] } },
  });
  if (already) return;
  await enqueueJob(assessmentId, "CREATE", {
    vehicleJson: JSON.stringify({
      vin: a.vehicle.vin,
      make: a.vehicle.make,
      model: a.vehicle.model,
      year: a.vehicle.year,
      seller_account: a.vehicle.seller.walletAddress,
    }),
    claimsJson: JSON.stringify(
      a.vehicle.claims.map((c) => ({
        type: c.type,
        declared_value: c.declaredValue,
      })),
    ),
  }, db);
}

/**
 * Move a record out of the state a route just checked, and queue the work
 * that move promises — together, or not at all.
 *
 * Checking a state and then writing it are two steps, and two requests a
 * millisecond apart (a double click, two open tabs) both pass the check.
 * So the claim only matches the state that was checked: exactly one
 * request wins it, and every other one is refused with `lost`. The row
 * stays locked until commit, so a loser sees the winner's finished work,
 * never a half-queued chain.
 *
 * The jobs go inside because a claim with nothing queued behind it strands
 * the record in a state no route will move it out of. And `queue` runs
 * AFTER the claim, so whatever it reads cannot change underneath it.
 */
export async function claimAndQueue<T>(
  assessmentId: string,
  claim: { from: string; to: string; packetVersion?: number; lost: string },
  queue: (db: Db) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const claimed = await tx.assessment.updateMany({
        where: { id: assessmentId, state: claim.from },
        data: {
          state: claim.to,
          ...(claim.packetVersion === undefined
            ? {}
            : { packetVersion: claim.packetVersion }),
        },
      });
      if (claimed.count === 0) throw conflict(claim.lost);
      return queue(tx);
    },
    { timeout: 20_000 },
  );
}

/**
 * Run `fn` holding the record's row, for writes that change no state but
 * must not interleave — with each other, or with a claim. Two sources added
 * at once would each find no CREATE queued and put the record on chain
 * twice; a source added while the packet is being sealed would miss the
 * seal it belongs to.
 */
export async function withRecordLock<T>(
  assessmentId: string,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const locked = await tx.assessment.updateMany({
        where: { id: assessmentId },
        data: { updatedAt: new Date() },
      });
      if (locked.count === 0) throw notFound("assessment");
      return fn(tx);
    },
    { timeout: 20_000 },
  );
}
