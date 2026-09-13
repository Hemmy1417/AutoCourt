import { prisma } from "@autocourt/db";

import { requireUser } from "../../../../lib/auth.js";
import { badRequest, errorResponse } from "../../../../lib/errors.js";

/** Revoke one of my sessions (not necessarily the current one). */
export async function DELETE(req: Request): Promise<Response> {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => null);
    const sessionId = String(body?.sessionId ?? "");
    if (!sessionId) throw badRequest("sessionId is required");
    await prisma.session.deleteMany({
      where: { id: sessionId, userId: user.id },
    });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
