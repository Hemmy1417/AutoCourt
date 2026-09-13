import { requireUser } from "../../../lib/auth.js";
import { errorResponse } from "../../../lib/errors.js";

export async function GET(req: Request): Promise<Response> {
  try {
    const user = await requireUser(req);
    return Response.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
