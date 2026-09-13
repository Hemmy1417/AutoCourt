import { prisma } from "@autocourt/db";

import { clientIp, requireUser } from "../../../../../lib/auth.js";
import {
  conflict,
  errorResponse,
  tooMany,
} from "../../../../../lib/errors.js";
import { allowBoth } from "../../../../../lib/ratelimit.js";
import { audit, enqueueJob, requireAccess } from "../../../../../lib/service.js";

/** Either recorded party may request adjudication once the packet is on-chain. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser(req);
    if (!allowBoth("assess", user.sessionId, clientIp(req))) throw tooMany();
    const { id } = await ctx.params;
    const { assessment } = await requireAccess(id, user.id);
    if (assessment.state !== "SUBMITTED")
      throw conflict(
        assessment.state === "PROCESSING"
          ? "an adjudication is already in flight"
          : `adjudication needs a submitted packet (state: ${assessment.state})`,
      );
    await enqueueJob(id, "ADJUDICATE", {});
    const updated = await prisma.assessment.update({
      where: { id },
      data: { state: "PROCESSING" },
    });
    await audit(user.id, "ADJUDICATION_REQUESTED", {});
    return Response.json({ assessment: updated });
  } catch (e) {
    return errorResponse(e);
  }
}
