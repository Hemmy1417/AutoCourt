import { createHmac } from "node:crypto";
import { prisma } from "@autocourt/db";

import { requireUser } from "../../../../lib/auth.js";
import { errorResponse, notFound } from "../../../../lib/errors.js";
import { audit } from "../../../../lib/service.js";

function hashToken(token: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET ?? "dev")
    .update(token)
    .digest("hex");
}

/**
 * Redeem a share link: the signed-in user gains buyer access on the
 * assessment. A revoked or expired link answers 404/410 — the wall-clock
 * window, never activity-counted (S13).
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  try {
    const user = await requireUser(req);
    const { token } = await ctx.params;
    const link = await prisma.shareLink.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { assessment: { include: { vehicle: true } } },
    });
    if (!link) throw notFound("share link");
    if (link.state === "REVOKED") {
      return Response.json(
        { code: "GONE", message: "this share link was revoked", details: null },
        { status: 410 },
      );
    }
    if (link.expiresAt < new Date()) {
      await prisma.shareLink.update({
        where: { id: link.id },
        data: { state: "EXPIRED" },
      });
      return Response.json(
        { code: "GONE", message: "this share link has expired", details: null },
        { status: 410 },
      );
    }
    if (link.assessment.vehicle.sellerId === user.id) {
      // The seller opening their own link gains nothing — and mints no
      // buyer role: the app-attested ladder starts honest.
      return Response.json({ assessmentId: link.assessmentId, role: "SELLER" });
    }
    await prisma.buyerAccess.upsert({
      where: {
        assessmentId_userId: {
          assessmentId: link.assessmentId,
          userId: user.id,
        },
      },
      create: {
        assessmentId: link.assessmentId,
        userId: user.id,
        viaLinkId: link.id,
      },
      update: {},
    });
    await audit(user.id, "SHARE_LINK_REDEEMED", { linkId: link.id });
    return Response.json({ assessmentId: link.assessmentId, role: "BUYER" });
  } catch (e) {
    return errorResponse(e);
  }
}
