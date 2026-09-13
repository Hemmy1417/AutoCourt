import { prisma } from "@autocourt/db";

import { requireUser } from "../../../../../lib/auth.js";
import {
  badRequest,
  errorResponse,
  forbidden,
} from "../../../../../lib/errors.js";
import { audit, enqueueJob, requireAccess } from "../../../../../lib/service.js";

/**
 * A buyer flags claims as disputed — the recorded opposing stake the
 * contract's corroboration ladder reads. Recorded on-chain via a job so
 * the stake exists where the derivation runs.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const { assessment, role } = await requireAccess(id, user.id);
    if (role !== "BUYER")
      throw forbidden("the seller of record cannot dispute their own claims");
    const body = await req.json().catch(() => null);
    const claimRowIds: string[] = Array.isArray(body?.claimRowIds)
      ? body.claimRowIds.map(String)
      : [];
    if (claimRowIds.length === 0)
      throw badRequest("name at least one claim to dispute");
    const note = String(body?.note ?? "").slice(0, 200);
    const claims = assessment.vehicle.claims.filter((c) =>
      claimRowIds.includes(c.id),
    );
    if (claims.length !== claimRowIds.length)
      throw badRequest("disputes must name claims on this assessment");

    const runsCount = assessment.runs.filter((r) => r.status === "SUCCESS").length;
    const created = await prisma.$transaction(
      claims.map((c) =>
        prisma.claimDispute.create({
          data: {
            claimRowId: c.id,
            disputerId: user.id,
            note,
            afterRuns: runsCount,
          },
        }),
      ),
    );
    await audit(user.id, "CLAIMS_DISPUTED", {
      claimIds: claims.map((c) => c.claimId),
      afterRuns: runsCount,
    });
    // The stake must be RECORDED where the ladder runs: on-chain.
    if (assessment.onChainId) {
      await enqueueJob(id, "RECORD_DISPUTE", {
        onChainId: assessment.onChainId,
        account: user.id,
        claimIdsJson: JSON.stringify(claims.map((c) => c.claimId)),
        note,
      });
    }
    return Response.json({ disputes: created }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
