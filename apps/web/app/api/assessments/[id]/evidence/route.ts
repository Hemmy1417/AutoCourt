import { EVIDENCE_CLASSES } from "@autocourt/shared-types";

import { clientIp, requireUser } from "../../../../../lib/auth.js";
import {
  badRequest,
  conflict,
  errorResponse,
  tooMany,
} from "../../../../../lib/errors.js";
import { allowBoth } from "../../../../../lib/ratelimit.js";
import {
  intakeEvidence,
  MAX_UPLOAD_BYTES,
  requireAccess,
} from "../../../../../lib/service.js";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser(req);
    if (!allowBoth("upload", user.sessionId, clientIp(req))) throw tooMany();
    const { id } = await ctx.params;
    const { assessment, role } = await requireAccess(id, user.id);
    if (assessment.state !== "DRAFT" && assessment.state !== "ADJUDICATED") {
      throw conflict(
        `evidence cannot be added while the assessment is ${assessment.state}`,
      );
    }
    const form = await req.formData().catch(() => null);
    if (!form) throw badRequest("multipart form data expected");
    const file = form.get("file");
    if (!(file instanceof File)) throw badRequest("a file part is required");
    if (file.size > MAX_UPLOAD_BYTES)
      throw badRequest(`file exceeds ${MAX_UPLOAD_BYTES} bytes`);
    const declaredClass = String(form.get("declaredClass") ?? "");
    if (!EVIDENCE_CLASSES.includes(declaredClass as never))
      throw badRequest("declaredClass outside the taxonomy");
    const declaredLabel = String(form.get("declaredLabel") ?? "").slice(0, 80);
    const captureDate = String(form.get("captureDate") ?? "").slice(0, 10);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const item = await intakeEvidence({
      assessmentId: id,
      uploaderId: user.id,
      uploaderRole: role,
      declaredClass,
      declaredLabel,
      bytes,
      captureDate,
    });
    return Response.json(item, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
