import { prisma } from "@autocourt/db";

import { clearedSessionCookie, userFromRequest } from "../../../../lib/auth.js";
import { errorResponse } from "../../../../lib/errors.js";

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await userFromRequest(req);
    if (user) {
      await prisma.session.delete({ where: { id: user.sessionId } }).catch(
        () => undefined,
      );
    }
    return Response.json(
      { ok: true },
      { headers: { "set-cookie": clearedSessionCookie() } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
