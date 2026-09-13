import { requireUser } from "../../../../lib/auth.js";
import { maxRunsPerAssessment } from "../../../../lib/chainconfig.js";
import { errorResponse } from "../../../../lib/errors.js";
import { requireAccess } from "../../../../lib/service.js";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const { assessment, role } = await requireAccess(id, user.id);
    // Evidence text is served only to parties on the record — and only
    // the app-side copy; the chain copy (once adjudicated) is public by
    // stated design, not through this endpoint.
    return Response.json({
      ...assessment,
      myRole: role,
      // The run limit travels with the record so the screen never has to
      // remember it. null means the contract was unreachable, which the
      // UI must show as unknown rather than as a number it made up.
      maxRuns: await maxRunsPerAssessment(),
      evidenceItems: assessment.evidenceItems.map((it) => ({
        ...it,
        extraction: it.extraction
          ? { status: it.extraction.status, normalizedText: it.extraction.normalizedText }
          : null,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
