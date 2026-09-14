import { prisma } from "@autocourt/db";

import { clientIp, requireUser } from "../../../../../lib/auth.js";
import {
  badRequest,
  conflict,
  errorResponse,
  forbidden,
  notFound,
  tooMany,
} from "../../../../../lib/errors.js";
import {
  evidenceWritePayload,
  manifestEntriesOf,
  manifestRoot,
  type ItemForPacket,
} from "../../../../../lib/packet.js";
import { allowBoth } from "../../../../../lib/ratelimit.js";
import {
  audit,
  claimAndQueue,
  ensureCreateJob,
  enqueueJob,
  loadAssessment,
  requireAccess,
  type AccessResult,
  type Db,
} from "../../../../../lib/service.js";

/**
 * Seal-and-submit: builds the exact chain write plan for this assessment
 * — create (if needed), one submit_evidence_text per consented item, the
 * dispute records, then the seal with the app-computed manifest root the
 * contract will recompute and verify. State → SUBMITTED; the worker
 * drains the jobs in order.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser(req);
    if (!allowBoth("assess", user.sessionId, clientIp(req))) throw tooMany();
    const { id } = await ctx.params;
    const { assessment: checked, role } = await requireAccess(id, user.id);
    if (role !== "SELLER")
      throw forbidden("only the seller submits the assessment");
    if (checked.state !== "DRAFT")
      throw conflict("this assessment has already been submitted");

    // THE PACKET IS READ UNDER THE CLAIM, not before it. Read before, a
    // double click queued two whole job chains, whose duplicate writes the
    // contract refuses — failing the real chain's seal behind them. And an
    // independent source added a moment earlier could miss a manifest root
    // the contract then rejects, because it recomputes the root over every
    // item it stores. Once the record is claimed, nothing can join it.
    const { root, packetItems } = await claimAndQueue(
      id,
      {
        from: "DRAFT",
        to: "SUBMITTED",
        packetVersion: 1,
        lost: "this assessment is already being submitted",
      },
      async (db) => {
        const assessment = await loadAssessment(id, db);
        if (!assessment) throw notFound("assessment");
        return queueSubmission(id, assessment, db);
      },
    );

    await audit(user.id, "ASSESSMENT_SUBMITTED", {
      manifestRoot: root,
      items: packetItems.map((i) => i.evidenceId),
    });
    const updated = await prisma.assessment.findUnique({ where: { id } });
    return Response.json({ assessment: updated, manifestRoot: root });
  } catch (e) {
    return errorResponse(e);
  }
}

async function queueSubmission(
  id: string,
  assessment: AccessResult["assessment"],
  db: Db,
): Promise<{ root: string; packetItems: ItemForPacket[] }> {
  const items = assessment.evidenceItems;
  if (items.length === 0)
    throw badRequest("add at least one evidence item before submitting");
  if (items.length > 8)
    throw badRequest("at most 8 items can be submitted at once (the contract's limit)");

  // An anchor is already on the chain — the contract fetched and
  // hashed it itself. It must never be re-sent through the uploaded
  // lane, and the packet cannot be sealed while one is still in
  // flight, because its real hashes are not known until it lands.
  const anchors = items.filter((i) => i.lane === "ANCHOR");
  const pendingAnchors = anchors.filter((i) => i.status === "PENDING_ENTRY");
  if (pendingAnchors.length > 0) {
    throw badRequest(
      "an independent source is still entering the record — validators " +
        "must agree on the bytes they fetched before the packet can be " +
        "sealed",
      { evidenceIds: pendingAnchors.map((i) => i.evidenceId) },
    );
  }
  const uploaded = items.filter((i) => i.lane !== "ANCHOR");

  const unconsented = uploaded.filter((i) => !i.consentedAt);
  if (unconsented.length > 0) {
    throw badRequest(
      "every packet item needs an explicit publicity consent first",
      { evidenceIds: unconsented.map((i) => i.evidenceId) },
    );
  }

  // Manifest entries cover EVERY stored item, anchors included; only
  // the uploaded ones need a submit_evidence_text write.
  const packetItems: ItemForPacket[] = items.map((i) => ({
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
  }));

  const root = manifestRoot(manifestEntriesOf(packetItems));
  const vehicle = assessment.vehicle;

  // The job chain. CREATE resolves the on-chain id; each later job
  // reads it from the assessment row at drain time.
  await ensureCreateJob(id, db);
  const uploadedIds = new Set(uploaded.map((i) => i.evidenceId));
  for (const item of packetItems) {
    if (!uploadedIds.has(item.evidenceId)) continue; // already on chain
    await enqueueJob(id, "SUBMIT_EVIDENCE", {
      itemJson: evidenceWritePayload(item),
    }, db);
  }
  const disputes = vehicle.claims.flatMap((c) =>
    c.disputes.map((d) => ({ claimId: c.claimId, d })),
  );
  const byDisputer = new Map<string, { claimIds: string[]; note: string }>();
  for (const { claimId, d } of disputes) {
    const wallet = d.disputer.walletAddress;
    const entry = byDisputer.get(wallet) ?? { claimIds: [], note: d.note };
    entry.claimIds.push(claimId);
    byDisputer.set(wallet, entry);
  }
  for (const [account, entry] of byDisputer) {
    await enqueueJob(id, "RECORD_DISPUTE", {
      account,
      claimIdsJson: JSON.stringify([...new Set(entry.claimIds)]),
      note: entry.note,
    }, db);
  }
  await enqueueJob(id, "SEAL", { manifestRoot: root }, db);
  return { root, packetItems };
}
