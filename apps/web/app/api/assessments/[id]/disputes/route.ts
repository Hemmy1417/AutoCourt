import { requireUser } from "../../../../../lib/auth.js";
import {
  badRequest,
  conflict,
  errorResponse,
  forbidden,
} from "../../../../../lib/errors.js";
import {
  audit,
  enqueueJob,
  requireAccess,
  withRecordLock,
} from "../../../../../lib/service.js";

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

    // A double click recorded the same stake twice — two rows here, and two
    // entries on chain, where the contract appends a dispute rather than
    // replacing one. Under the record's lock, a buyer cannot dispute a
    // claim again until a new verdict gives them something new to dispute.
    const created = await withRecordLock(id, async (db) => {
      const repeated = await db.claimDispute.findMany({
        where: {
          disputerId: user.id,
          afterRuns: runsCount,
          claimRowId: { in: claims.map((c) => c.id) },
        },
        select: { claimRowId: true },
      });
      if (repeated.length > 0) {
        const named = claims
          .filter((c) => repeated.some((r) => r.claimRowId === c.id))
          .map((c) => c.claimId);
        throw conflict(
          `already disputed: ${named.join(", ")} — a dispute stands until the next verdict`,
        );
      }

      const rows = [];
      for (const c of claims) {
        rows.push(
          await db.claimDispute.create({
            data: {
              claimRowId: c.id,
              disputerId: user.id,
              note,
              afterRuns: runsCount,
            },
          }),
        );
      }
      // The stake must be RECORDED where the ladder runs: on-chain, under
      // the wallet address that IS the account.
      //
      // Which write records it depends on the STATE, never on whether the
      // record happens to be on chain yet. A draft carries every dispute
      // into its submission, which reads them under its claim — so queueing
      // one here too put the same stake on chain twice whenever an anchor
      // had already created the record. After submission, the dispute
      // queues its own write, and the drainer supplies the on-chain id when
      // it exists; waiting for one here dropped a dispute made in the
      // moments before the record's creation landed.
      const { state } = await db.assessment.findUniqueOrThrow({
        where: { id },
        select: { state: true },
      });
      if (state !== "DRAFT") {
        await enqueueJob(id, "RECORD_DISPUTE", {
          account: user.walletAddress,
          claimIdsJson: JSON.stringify(claims.map((c) => c.claimId)),
          note,
        }, db);
      }
      return rows;
    });

    await audit(user.id, "CLAIMS_DISPUTED", {
      claimIds: claims.map((c) => c.claimId),
      afterRuns: runsCount,
    });
    return Response.json({ disputes: created }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
