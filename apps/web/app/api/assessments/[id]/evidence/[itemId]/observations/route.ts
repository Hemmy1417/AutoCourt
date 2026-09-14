import { prisma } from "@autocourt/db";
import { parseDtc } from "@autocourt/validation";

import { requireUser } from "../../../../../../../lib/auth.js";
import {
  badRequest,
  errorResponse,
  forbidden,
  notFound,
} from "../../../../../../../lib/errors.js";
import { audit, requireAccess } from "../../../../../../../lib/service.js";

/**
 * Typed observation rows (screen 7 — diagnostics input): dated odometer
 * readings and normalized OBD-II codes attached to an evidence item.
 * These are the rows the CONTRACT recomputes conflicts from — a reading
 * that exists only inside free text can never raise a code flag.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; itemId: string }> },
): Promise<Response> {
  try {
    const user = await requireUser(req);
    const { id, itemId } = await ctx.params;
    await requireAccess(id, user.id);
    const item = await prisma.evidenceItem.findUnique({ where: { id: itemId } });
    if (!item || item.assessmentId !== id) throw notFound("evidence item");
    if (item.uploaderId !== user.id)
      throw forbidden("only the uploader annotates their own evidence");
    if (item.consentedAt)
      throw badRequest(
        "this item is already consented for a packet; its typed rows are fixed",
      );
    const body = await req.json().catch(() => null);
    const rows = Array.isArray(body?.rows) ? body.rows : null;
    if (!rows || rows.length === 0 || rows.length > 12)
      throw badRequest("add between 1 and 12 readings");
    const cleaned = rows.map((r: Record<string, unknown>, i: number) => {
      const docDate = String(r.docDate ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(docDate))
        throw badRequest(`reading ${i + 1}: the date is not a valid calendar date`);
      const out: {
        evidenceItemId: string;
        docDate: string;
        sourceField: string;
        odometerReading?: number;
        odometerUnit?: string;
        diagnosticCode?: string;
      } = {
        evidenceItemId: itemId,
        docDate,
        sourceField: String(r.sourceField ?? "").slice(0, 60),
      };
      if (r.odometerReading !== undefined && r.odometerReading !== null && r.odometerReading !== "") {
        const reading = Number(r.odometerReading);
        if (!Number.isInteger(reading) || reading < 0 || reading > 3_000_000)
          throw badRequest(`reading ${i + 1}: the odometer reading is out of range`);
        const unit = String(r.odometerUnit ?? "MILES").toUpperCase();
        if (unit !== "MILES" && unit !== "KM")
          throw badRequest(`reading ${i + 1}: the unit must be miles or kilometres`);
        out.odometerReading = reading;
        out.odometerUnit = unit;
      }
      if (r.diagnosticCode) {
        const dtc = parseDtc(String(r.diagnosticCode));
        if (!dtc)
          throw badRequest(
            `row ${i + 1}: "${String(r.diagnosticCode)}" is not a valid ` +
              "OBD-II code (shape: P0301)",
          );
        out.diagnosticCode = dtc.code;
      }
      return out;
    });
    await prisma.diagnosticObservation.deleteMany({
      where: { evidenceItemId: itemId },
    });
    await prisma.diagnosticObservation.createMany({ data: cleaned });
    await audit(user.id, "OBSERVATIONS_RECORDED", {
      evidenceId: item.evidenceId,
      rows: cleaned.length,
    }, itemId);
    const fresh = await prisma.evidenceItem.findUnique({
      where: { id: itemId },
      include: { observations: true },
    });
    return Response.json(fresh);
  } catch (e) {
    return errorResponse(e);
  }
}
