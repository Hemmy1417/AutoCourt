import { prisma } from "@autocourt/db";

import { requireUser } from "../../../lib/auth.js";
import { errorResponse } from "../../../lib/errors.js";

/** What a person needs to recognise which record a row belongs to. */
const VEHICLE = { select: { year: true, make: true, model: true } } as const;

/** Screen 13's backing: profile, sessions, evidence visibility, links. */
export async function GET(req: Request): Promise<Response> {
  try {
    const user = await requireUser(req);
    const [sessions, evidence, links] = await Promise.all([
      prisma.session.findMany({
        where: { userId: user.id, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true, expiresAt: true },
      }),
      prisma.evidenceItem.findMany({
        where: { uploaderId: user.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          assessmentId: true,
          evidenceId: true,
          declaredClass: true,
          declaredLabel: true,
          status: true,
          redactionStatus: true,
          consentedAt: true,
          onChainTxHash: true,
          createdAt: true,
          // Enough to tell a published item from one still private, even
          // for records indexed from the chain, which carry no tx hashes.
          assessment: {
            select: {
              onChainId: true,
              state: true,
              vehicle: VEHICLE,
              runs: { select: { status: true, createdAt: true } },
            },
          },
        },
      }),
      prisma.shareLink.findMany({
        where: { assessment: { vehicle: { sellerId: user.id } } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          assessmentId: true,
          state: true,
          expiresAt: true,
          createdAt: true,
          assessment: { select: { onChainId: true, vehicle: VEHICLE } },
        },
      }),
    ]);
    return Response.json({
      profile: {
        id: user.id,
        walletAddress: user.walletAddress,
        displayName: user.displayName,
      },
      currentSessionId: user.sessionId,
      sessions,
      evidence,
      shareLinks: links,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
