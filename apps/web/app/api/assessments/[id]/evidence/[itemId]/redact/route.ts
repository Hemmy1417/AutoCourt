import { prisma } from "@autocourt/db";

import { requireUser } from "../../../../../../../lib/auth.js";
import {
  badRequest,
  errorResponse,
  forbidden,
  notFound,
} from "../../../../../../../lib/errors.js";
import { redactEvidence, requireAccess } from "../../../../../../../lib/service.js";

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
      throw forbidden("only the uploader redacts their own evidence");
    const body = await req.json().catch(() => null);
    const spans = Array.isArray(body?.spans) ? body.spans : null;
    if (!spans) throw badRequest("spans array is required");
    for (const s of spans) {
      if (
        !Number.isInteger(s?.start) ||
        !Number.isInteger(s?.end) ||
        s.start < 0 ||
        s.end <= s.start
      )
        throw badRequest("each span needs integer start < end");
    }
    const updated = await redactEvidence(itemId, user.id, spans);
    return Response.json(updated);
  } catch (e) {
    return errorResponse(e);
  }
}
