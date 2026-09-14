import { prisma } from "@autocourt/db";

import { clientIp, requireUser } from "../../../../../lib/auth.js";
import {
  maxNewItemsPerAppeal,
  maxRunsPerAssessment,
} from "../../../../../lib/chainconfig.js";
import {
  badRequest,
  conflict,
  errorResponse,
  tooMany,
} from "../../../../../lib/errors.js";
import {
  evidenceWritePayload,
  type ItemForPacket,
} from "../../../../../lib/packet.js";
import { allowBoth } from "../../../../../lib/ratelimit.js";
import {
  audit,
  claimAndQueue,
  enqueueJob,
  requireAccess,
} from "../../../../../lib/service.js";

/**
 * Appeal: NEW evidence items (uploaded after the verdict, consented)
 * enter through submit_appeal_evidence jobs, then readjudicate. RECORDED
 * items are never re-sent — the contract reads them from its own storage
 * by construction.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser(req);
    if (!allowBoth("assess", user.sessionId, clientIp(req))) throw tooMany();
    const { id } = await ctx.params;
    const { assessment } = await requireAccess(id, user.id);
    if (assessment.state !== "ADJUDICATED")
      throw conflict(`an appeal needs a standing verdict (state: ${assessment.state})`);
    // The runs cap belongs to the contract, and the contract enforces it.
    // Checking here too is not redundant: without it the appeal is
    // accepted, evidence is written on chain, and only the readjudicate
    // job fails — leaving the record carrying items filed for an appeal
    // that could never happen. If the cap cannot be read, do NOT guess:
    // let it through and let the contract refuse for itself.
    const maxRuns = await maxRunsPerAssessment();
    const successRuns = assessment.runs.filter((r) => r.status === "SUCCESS").length;
    if (maxRuns !== null && successRuns >= maxRuns)
      throw conflict(
        `this record already holds the ${maxRuns} runs the contract allows`,
      );
    const body = await req.json().catch(() => null);
    const grounds = String(body?.grounds ?? "").trim();
    if (grounds.length < 1 || grounds.length > 1200)
      throw badRequest("grounds must be 1-1200 characters");
    const newItemRowIds: string[] = Array.isArray(body?.newEvidenceIds)
      ? body.newEvidenceIds.map(String)
      : [];
    const maxNewItems = await maxNewItemsPerAppeal();
    if (maxNewItems !== null && newItemRowIds.length > maxNewItems)
      throw badRequest(
        `at most ${maxNewItems} new items per appeal (the contract's cap)`,
      );

    const newItems = assessment.evidenceItems.filter(
      (i) => newItemRowIds.includes(i.id) && !i.onChainTxHash,
    );
    if (newItems.length !== newItemRowIds.length)
      throw badRequest("newEvidenceIds must be un-submitted items on this assessment");
    const unconsented = newItems.filter((i) => !i.consentedAt);
    if (unconsented.length > 0)
      throw badRequest("every appeal item needs an explicit publicity consent", {
        evidenceIds: unconsented.map((i) => i.evidenceId),
      });

    const itemWrites = newItems.map((i) => {
      const packetItem: ItemForPacket = {
        evidenceId: i.evidenceId,
        declaredClass: i.declaredClass,
        declaredLabel: i.declaredLabel,
        uploaderAccount: i.uploader.walletAddress,
        uploaderRole: i.uploaderRole as "SELLER" | "BUYER",
        fileSha256: i.fileSha256,
        normalizedText: i.extraction?.normalizedText ?? "",
        textSha256: i.textSha256,
        extractorVersion: i.extractorVersion,
        status: i.status === "EXTRACTED" ? "EXTRACTED" : "UNEXTRACTED",
        uploaderSignature: i.uploaderSignature,
        observations: i.observations
          .filter((o) => o.odometerReading !== null)
          .map((o) => ({
            doc_date: o.docDate,
            odometer_reading: o.odometerReading as number,
            odometer_unit: (o.odometerUnit ?? "MILES") as "MILES" | "KM",
            source_field: o.sourceField,
          })),
        diagnosticCodes: i.observations
          .map((o) => o.diagnosticCode)
          .filter((c): c is string => Boolean(c)),
        captureDate: i.captureDate,
        consentedAt: i.consentedAt,
      };
      return evidenceWritePayload(packetItem);
    });

    // A double click used to file two appeals: each wrote its evidence to
    // the chain and queued its own re-adjudication, spending a second run
    // of the few the contract allows. Only one request can claim the
    // standing verdict.
    const appeal = await claimAndQueue(
      id,
      {
        from: "ADJUDICATED",
        to: "PROCESSING",
        lost: "an appeal is already in flight",
      },
      async (db) => {
        for (const itemJson of itemWrites)
          await enqueueJob(id, "SUBMIT_APPEAL_EVIDENCE", { itemJson }, db);
        await enqueueJob(
          id,
          "READJUDICATE",
          { appellantAccount: user.walletAddress, grounds },
          db,
        );
        return db.appeal.create({
          data: { assessmentId: id, appellantId: user.id, grounds },
        });
      },
    );
    const updated = await prisma.assessment.findUnique({ where: { id } });
    await audit(user.id, "APPEAL_FILED", {
      grounds: grounds.slice(0, 120),
      newItems: newItems.map((i) => i.evidenceId),
    });
    return Response.json({ appeal, assessment: updated }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
