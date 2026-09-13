import { prisma } from "@autocourt/db";

import { requireUser } from "../../../lib/auth.js";
import { badRequest, errorResponse, forbidden, notFound } from "../../../lib/errors.js";
import { clampLimit, decodeCursor, encodeCursor } from "../../../lib/cursor.js";

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => null);
    const vehicleId = String(body?.vehicleId ?? "");
    if (!vehicleId) throw badRequest("vehicleId is required");
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
    });
    if (!vehicle) throw notFound("vehicle");
    if (vehicle.sellerId !== user.id)
      throw forbidden("only the seller opens an assessment");
    const assessment = await prisma.assessment.create({
      data: { vehicleId },
    });
    return Response.json(assessment, { status: 201 });
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
    const rows = await prisma.assessment.findMany({
      where: {
        OR: [
          { vehicle: { sellerId: user.id } },
          { buyerAccess: { some: { userId: user.id } } },
        ],
        ...(cursor
          ? {
              AND: [
                {
                  OR: [
                    { createdAt: { lt: new Date(cursor.createdAt) } },
                    {
                      createdAt: new Date(cursor.createdAt),
                      id: { lt: cursor.id },
                    },
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        vehicle: { select: { vin: true, make: true, model: true, year: true, sellerId: true } },
        runs: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return Response.json({
      items: page.map((a) => ({
        ...a,
        myRole: a.vehicle.sellerId === user.id ? "SELLER" : "BUYER",
      })),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
