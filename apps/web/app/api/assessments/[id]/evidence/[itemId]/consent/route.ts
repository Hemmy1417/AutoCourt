import { prisma } from "@autocourt/db";
import { verifyMessage } from "viem";

import { attestationMessage } from "../../../../../../../lib/attest.js";

import { requireUser } from "../../../../../../../lib/auth.js";
import {
  badRequest,
  errorResponse,
  forbidden,
  notFound,
} from "../../../../../../../lib/errors.js";
import { audit, requireAccess } from "../../../../../../../lib/service.js";

/**
 * The explicit per-item publicity consent (ARCHITECTURE §8.2). The
 * client must echo the exact statement version it displayed; the packet
 * builder refuses any item without this timestamp.
 */
const CONSENT_VERSION = "publicity-statement-1";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; itemId: string }> },
): Promise<Response> {
  try {
    const user = await requireUser(req);
    const { id, itemId } = await ctx.params;
    await requireAccess(id, user.id);
    const item = await prisma.evidenceItem.findUnique({ where: { id: itemId } });
    if (!item || item.assessmentId !== id) throw notFound("evidence item");
    if (item.uploaderId !== user.id)
      throw forbidden("only the uploader consents for their own evidence");
    const body = await req.json().catch(() => null);
    if (String(body?.consentVersion) !== CONSENT_VERSION)
      throw badRequest(
        "consent requires acknowledging the current publicity statement",
      );
    // The uploader's attestation over the FINAL bytes. Optional, and
    // verified here rather than trusted: a signature that does not
    // recover to the uploader's own wallet over this item's current
    // hashes is refused outright, so nothing meaningless reaches the
    // public record. An item consented without one is recorded as
    // unsigned, which the record says plainly.
    let uploaderSignature = "";
    const signature = String(body?.signature ?? "").trim();
    if (signature) {
      const uploader = await prisma.user.findUnique({
        where: { id: item.uploaderId },
        select: { walletAddress: true },
      });
      const ok =
        uploader &&
        (await verifyMessage({
          address: uploader.walletAddress as `0x${string}`,
          message: attestationMessage({
            evidenceId: item.evidenceId,
            textSha256: item.textSha256,
            fileSha256: item.fileSha256,
          }),
          signature: signature as `0x${string}`,
        }).catch(() => false));
      if (!ok) {
        throw badRequest(
          "that signature does not attest these bytes from your wallet — " +
            "it may have been signed before a redaction changed the text",
        );
      }
      uploaderSignature = signature;
    }

    const updated = await prisma.evidenceItem.update({
      where: { id: itemId },
      data: { consentedAt: new Date(), uploaderSignature },
    });
    await audit(user.id, "PUBLICITY_CONSENT", {
      evidenceId: item.evidenceId,
      consentVersion: CONSENT_VERSION,
      attested: Boolean(uploaderSignature),
    }, item.id);
    return Response.json(updated);
  } catch (e) {
    return errorResponse(e);
  }
}
