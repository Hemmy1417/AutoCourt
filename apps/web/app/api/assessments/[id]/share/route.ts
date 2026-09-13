import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "@autocourt/db";

import { requireUser } from "../../../../../lib/auth.js";
import {
  badRequest,
  errorResponse,
  forbidden,
  notFound,
} from "../../../../../lib/errors.js";
import { audit, requireAccess } from "../../../../../lib/service.js";

function hashToken(token: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET ?? "dev")
    .update(token)
    .digest("hex");
}

/** Create a signed, expiring, revocable share link (seller only). */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const { role } = await requireAccess(id, user.id);
    if (role !== "SELLER") throw forbidden("only the seller shares");
    const body = await req.json().catch(() => ({}));
    const days = Math.min(90, Math.max(1, Number(body?.expiresInDays ?? 14)));
    const token = randomBytes(24).toString("base64url");
    const link = await prisma.shareLink.create({
      data: {
        assessmentId: id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + days * 86_400_000),
      },
    });
    await audit(user.id, "SHARE_LINK_CREATED", { linkId: link.id, days });
    // The raw token appears exactly once, here; only its hash is stored.
    return Response.json({ id: link.id, token, expiresAt: link.expiresAt }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Revoke — the app's copy only, and the UI says so (§8.2). */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const { role } = await requireAccess(id, user.id);
    if (role !== "SELLER") throw forbidden("only the seller revokes");
    const body = await req.json().catch(() => null);
    const linkId = String(body?.linkId ?? "");
    if (!linkId) throw badRequest("linkId is required");
    const link = await prisma.shareLink.findUnique({ where: { id: linkId } });
    if (!link || link.assessmentId !== id) throw notFound("share link");
    const updated = await prisma.shareLink.update({
      where: { id: linkId },
      data: { state: "REVOKED", revokedAt: new Date() },
    });
    await audit(user.id, "SHARE_LINK_REVOKED", { linkId });
    return Response.json(updated);
  } catch (e) {
    return errorResponse(e);
  }
}
