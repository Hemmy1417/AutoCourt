import { prisma } from "@autocourt/db";

import { clientIp, requireUser } from "../../../../../lib/auth.js";
import {
  conflict,
  errorResponse,
  tooMany,
} from "../../../../../lib/errors.js";
import { statePhrase } from "../../../../../lib/present.js";
import { allowBoth } from "../../../../../lib/ratelimit.js";
import {
  audit,
  claimAndQueue,
  enqueueJob,
  requireAccess,
} from "../../../../../lib/service.js";

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
          : `adjudication needs a submitted packet, and this record is ${statePhrase(assessment.state)}`,
      );
    // A double click, or two open tabs, used to put two adjudications on
    // the chain: both requests passed the check above before either wrote
    // PROCESSING. The contract refused the second ("already judged this
    // exact packet"), but it cost a real transaction and fee for nothing.
    await claimAndQueue(
      id,
      {
        from: assessment.state,
        to: "PROCESSING",
        lost: "an adjudication is already in flight",
      },
      (db) => enqueueJob(id, "ADJUDICATE", {}, db),
    );
    await audit(user.id, "ADJUDICATION_REQUESTED", {});
    return Response.json({
      assessment: await prisma.assessment.findUnique({ where: { id } }),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
