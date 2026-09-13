import { prisma } from "@autocourt/db";

import {
  clientIp,
  createSession,
  sessionCookie,
  verifyPassword,
} from "../../../../lib/auth.js";
import { ApiError, errorResponse, tooMany } from "../../../../lib/errors.js";
import { allowBoth } from "../../../../lib/ratelimit.js";

export async function POST(req: Request): Promise<Response> {
  try {
    if (!allowBoth("auth", null, clientIp(req))) throw tooMany();
    const body = await req.json().catch(() => null);
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const user = await prisma.user.findUnique({ where: { email } });
    const ok = user && (await verifyPassword(user.passwordHash, password));
    if (!ok) {
      throw new ApiError(401, "BAD_CREDENTIALS", "email or password is wrong");
    }
    const token = await createSession(user.id);
    return Response.json(
      { id: user.id, email: user.email, displayName: user.displayName },
      { headers: { "set-cookie": sessionCookie(token) } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
