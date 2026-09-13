import { prisma } from "@autocourt/db";

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
export const CONSENT_VERSION = "publicity-statement-1";

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
    const updated = await prisma.evidenceItem.update({
      where: { id: itemId },
      data: { consentedAt: new Date() },
    });
    await audit(user.id, "PUBLICITY_CONSENT", {
      evidenceId: item.evidenceId,
      consentVersion: CONSENT_VERSION,
    }, item.id);
    return Response.json(updated);
  } catch (e) {
    return errorResponse(e);
  }
}
