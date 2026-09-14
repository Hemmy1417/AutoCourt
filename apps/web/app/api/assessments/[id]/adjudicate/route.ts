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
    // FAILED is retryable by either party (S26's exit); each retry is a
    // NEW attempt with its own transaction hash.
    if (assessment.state !== "SUBMITTED" && assessment.state !== "FAILED")
      throw conflict(
        assessment.state === "PROCESSING"
          ? "an adjudication is already in flight"
          : `adjudication needs a submitted packet (state: ${assessment.state})`,
      );
    // CLAIM THE RECORD BEFORE QUEUEING ANYTHING. Reading the state and
    // then writing it are two steps, and two requests a millisecond
    // apart both passed the check above before either wrote PROCESSING
    // — so a double click, or two open tabs, put two adjudications on
    // the chain. The contract refused the second ("already judged this
    // exact packet") and no verdict was corrupted, but it cost a real
    // transaction and a real fee for nothing. This update is the claim:
    // it only matches from the state we just validated, so exactly one
    // request can win it.
    const claimed = await prisma.assessment.updateMany({
      where: { id, state: assessment.state },
      data: { state: "PROCESSING" },
    });
    if (claimed.count === 0) throw conflict("an adjudication is already in flight");

    await enqueueJob(id, "ADJUDICATE", {});
    await audit(user.id, "ADJUDICATION_REQUESTED", {});
    return Response.json({
      assessment: await prisma.assessment.findUnique({ where: { id } }),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
