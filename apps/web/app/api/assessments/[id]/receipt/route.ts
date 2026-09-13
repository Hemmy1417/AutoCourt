import { requireUser } from "../../../../../lib/auth.js";
import { chain } from "../../../../../lib/chain.js";
import { errorResponse, notFound } from "../../../../../lib/errors.js";
import { requireAccess } from "../../../../../lib/service.js";

/**
 * The intake receipt (ARCHITECTURE §3.6): every party sees, from the
 * CONTRACT's manifest, whether each of their items is in the judged
 * record — so a silently dropped item is visible to the party who
 * uploaded it. Omission is the operator's cheapest attack; this surface
 * is the detection.
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
    const onChain = await chain().getAssessment(assessment.onChainId);
    const version = Number(onChain["packet_version"] ?? 0);
    const manifests: Record<number, unknown> = {};
    for (let v = 1; v <= version; v++) {
      manifests[v] = await chain().getManifest(assessment.onChainId, v);
    }
    const chainItems = (onChain["items"] as Array<Record<string, unknown>>) ?? [];
    const mine = assessment.evidenceItems
      .filter((i) => i.uploaderId === user.id)
      .map((i) => {
        const onRecord = chainItems.find(
          (ci) => ci["evidence_id"] === i.evidenceId,
        );
        return {
          evidenceId: i.evidenceId,
          fileSha256: i.fileSha256,
          textSha256: i.textSha256,
          onChain: Boolean(onRecord),
          judgedVersion: onRecord ? Number(onRecord["judged_version"] ?? 0) : null,
          status: onRecord ? String(onRecord["status"]) : "NOT IN ANY RUN",
        };
      });
    return Response.json({
      onChainId: assessment.onChainId,
      contractAddress: chain().address,
      packetVersion: version,
      manifests,
      myItems: mine,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
