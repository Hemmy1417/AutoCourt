import { prisma } from "@autocourt/db";

import { requireUser } from "../../../../../lib/auth.js";
import { errorResponse } from "../../../../../lib/errors.js";
import { requireAccess } from "../../../../../lib/service.js";

/**
 * The write lifecycle, visible: every queued chain write for this
 * assessment with its state, transaction hash and — when consensus
 * refused it — the contract's own sentence. Parties on the record only.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    await requireAccess(id, user.id);
    const jobs = await prisma.job.findMany({
      where: { assessmentId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        kind: true,
        state: true,
        attempts: true,
        txHash: true,
        lastError: true,
        createdAt: true,
      },
    });
    return Response.json({ jobs });
  } catch (e) {
    return errorResponse(e);
  }
}
