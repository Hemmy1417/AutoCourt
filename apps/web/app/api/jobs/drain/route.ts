import { recordJobEffects, runPendingJobs } from "@autocourt/worker-core";
import { timingSafeEqual } from "node:crypto";

import { chain } from "../../../../lib/chain.js";
import { ApiError, errorResponse } from "../../../../lib/errors.js";

/**
 * The serverless mover (S26): a platform cron hits this route on a fixed
 * cadence; the job lease guarantees a dead invocation strands nothing.
 * The long-lived apps/worker calls the same functions directly.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const expected = process.env.DRAIN_TOKEN ?? "";
    const got = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
    const a = Buffer.from(got);
    const b = Buffer.from(expected);
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ApiError(401, "UNAUTHORIZED", "drain token required");
    }
    const result = await runPendingJobs({ chain: chain() });
    const effects = await recordJobEffects(chain());
    return Response.json({ ...result, effects });
  } catch (e) {
    return errorResponse(e);
  }
}
