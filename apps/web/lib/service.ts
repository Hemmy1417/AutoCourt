/**
 * Domain services shared by the route handlers: role resolution, evidence
 * intake, job enqueueing, and the audit trail. Route files stay thin.
 */

import { prisma } from "@autocourt/db";
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

import { badRequest, forbidden, notFound } from "./errors.js";

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

async function loadAssessment(id: string) {
  return prisma.assessment.findUnique({
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
): Promise<string> {
  const job = await prisma.job.create({
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
