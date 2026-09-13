import { requireUser } from "../../../../../lib/auth.js";
import { chain } from "../../../../../lib/chain.js";
import { errorResponse, notFound } from "../../../../../lib/errors.js";
import { requireAccess } from "../../../../../lib/service.js";

/**
 * The standing verdict — straight from the CONTRACT view (DB caches,
 * chain decides). Returns the run number and total runs so a superseded
 * verdict can never be confused with the standing one, and the DB's
 * attempt rows (REJECTED/FAILED with tx hashes) alongside.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const { assessment } = await requireAccess(id, user.id);
    if (!assessment.onChainId) throw notFound("on-chain record");
    const verdict = await chain().getVerdict(assessment.onChainId);
    // A record created before a redeploy still resolves by id, but on a
    // contract with no history for it. Say which contract it belongs to
    // rather than rendering an empty verdict.
    const recordedContract = assessment.contractAddress || chain().address;
    return Response.json({
      onChainId: assessment.onChainId,
      contractAddress: chain().address,
      recordedContract,
      supersededRecord:
        recordedContract.toLowerCase() !== chain().address.toLowerCase(),
      verdict,
      attempts: assessment.runs.map((r) => ({
        runNumber: r.runNumber,
        status: r.status,
        kind: r.kind,
        txHash: r.txHash,
        errorText: r.errorText,
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
