import { prisma } from "@autocourt/db";
import { checkVin } from "@autocourt/validation";
import { CLAIM_TYPES } from "@autocourt/shared-types";

import { clientIp, requireUser } from "../../../lib/auth.js";
import { badRequest, errorResponse, tooMany } from "../../../lib/errors.js";
import { allowBoth } from "../../../lib/ratelimit.js";
import { clampLimit, decodeCursor, encodeCursor } from "../../../lib/cursor.js";

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await requireUser(req);
    if (!allowBoth("upload", user.sessionId, clientIp(req))) throw tooMany();
    const body = await req.json().catch(() => null);
    const vinCheck = checkVin(String(body?.vin ?? ""));
    if (!vinCheck.formatValid)
      throw badRequest(
        vinCheck.problem ??
          "VIN must be 17 characters from the VIN alphabet (no I, O, Q)",
      );
    const vin = vinCheck.vin;
    const make = String(body?.make ?? "").trim();
    const model = String(body?.model ?? "").trim();
    const year = Number(body?.year);
    if (!make || make.length > 60 || !model || model.length > 60)
      throw badRequest("make and model are both required, up to 60 characters each");
    if (!Number.isInteger(year) || year < 1950 || year > 2035)
      throw badRequest("the year must be between 1950 and 2035");
    const claims = Array.isArray(body?.claims) ? body.claims : [];
    if (claims.length < 1 || claims.length > 12)
      throw badRequest("list between 1 and 12 claims");
    for (const c of claims) {
      if (!CLAIM_TYPES.includes(String(c?.type) as never))
        throw badRequest(`unknown claim type: ${String(c?.type)}`);
      const v = String(c?.declaredValue ?? "").trim();
      if (!v || v.length > 160)
        throw badRequest("each claim needs a declared value of up to 160 characters");
    }
    const vehicle = await prisma.vehicle.create({
      data: {
        vin,
        // A fact, not a gate: genuine non-North-American VINs fail it.
        vinCheckDigitOk: vinCheck.checkDigit === "VALID",
        make,
        model,
        year,
        sellerId: user.id,
        claims: {
          create: claims.map((c: { type: string; declaredValue: string }, i: number) => ({
            claimId: `CL-${String(i + 1).padStart(2, "0")}`,
            type: String(c.type),
            declaredValue: String(c.declaredValue).trim(),
          })),
        },
      },
      include: { claims: true },
    });
    return Response.json(vehicle, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(req: Request): Promise<Response> {
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const limit = clampLimit(url.searchParams.get("limit"));
    const cursor = decodeCursor(url.searchParams.get("cursor"));
    const rows = await prisma.vehicle.findMany({
      where: {
        sellerId: user.id,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                {
                  createdAt: new Date(cursor.createdAt),
                  id: { lt: cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        claims: true,
        assessments: {
          select: { id: true, state: true, onChainId: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return Response.json({
      items: page,
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
