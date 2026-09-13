import { prisma } from "@autocourt/db";

import {
  createSession,
  hashPassword,
  sessionCookie,
  clientIp,
} from "../../../../lib/auth.js";
import { badRequest, conflict, errorResponse, tooMany } from "../../../../lib/errors.js";
import { allowBoth } from "../../../../lib/ratelimit.js";

export async function POST(req: Request): Promise<Response> {
  try {
    if (!allowBoth("auth", null, clientIp(req))) throw tooMany();
    const body = await req.json().catch(() => null);
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const displayName = String(body?.displayName ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      throw badRequest("a valid email is required");
    if (password.length < 10)
      throw badRequest("password must be at least 10 characters");
    if (displayName.length < 1 || displayName.length > 60)
      throw badRequest("display name must be 1-60 characters");
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw conflict("an account with this email already exists");
    const user = await prisma.user.create({
      data: { email, passwordHash: await hashPassword(password), displayName },
    });
    const token = await createSession(user.id);
    return Response.json(
      { id: user.id, email: user.email, displayName: user.displayName },
      { status: 201, headers: { "set-cookie": sessionCookie(token) } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
