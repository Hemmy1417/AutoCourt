import { requireUser } from "../../../../../../lib/auth.js";
import { chain } from "../../../../../../lib/chain.js";
import { errorResponse, notFound } from "../../../../../../lib/errors.js";
import { requireAccess } from "../../../../../../lib/service.js";

/** One run's full record — findings, quotes, statuses — from the chain. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; n: string }> },
): Promise<Response> {
  try {
    const user = await requireUser(req);
    const { id, n } = await ctx.params;
    const { assessment } = await requireAccess(id, user.id);
    if (!assessment.onChainId) throw notFound("on-chain record");
    const run = await chain().getRun(assessment.onChainId, Number(n));
    return Response.json({ onChainId: assessment.onChainId, run });
  } catch (e) {
    return errorResponse(e);
  }
}
