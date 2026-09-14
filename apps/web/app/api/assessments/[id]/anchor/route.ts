import { createHash } from "node:crypto";

import { clientIp, requireUser } from "../../../../../lib/auth.js";
import { chain } from "../../../../../lib/chain.js";
import {
  badRequest,
  conflict,
  errorResponse,
  tooMany,
} from "../../../../../lib/errors.js";
import { allowBoth } from "../../../../../lib/ratelimit.js";
import {
  audit,
  ensureCreateJob,
  enqueueJob,
  requireAccess,
  withRecordLock,
} from "../../../../../lib/service.js";

/**
 * The independent-anchor lane, from the app.
 *
 * This is the only evidence path where the CONTRACT fetches: every
 * validator reads the allowlisted page itself and must agree on its
 * hash. It is also the only path to `VERIFIED`, so leaving it
 * script-only meant the strongest verdict in the system was unreachable
 * by anyone actually using the product.
 *
 * The app fetches the page once to show the party what they are adding
 * and to commit an expected hash. Whether that hash matches what
 * validators render is not ours to promise: if it differs, the contract
 * records the item SOURCE_UNAVAILABLE and it is never judged. That is
 * disclosed at the point of adding, not discovered afterwards.
 */

const FETCH_CAP = 8_000; // must equal the contract's ANCHOR_FETCH_CAP

const sha = (s: string) =>
  createHash("sha256").update(s, "utf8").digest("hex");

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser(req);
    if (!allowBoth("upload", user.sessionId, clientIp(req))) throw tooMany();
    const { id } = await ctx.params;
    const { assessment, role } = await requireAccess(id, user.id);
    if (assessment.state !== "DRAFT") {
      throw conflict(
        `independent sources enter before submission (state: ${assessment.state})`,
      );
    }

    const body = await req.json().catch(() => null);
    const url = String(body?.url ?? "").trim();
    const declaredLabel = String(body?.declaredLabel ?? "").slice(0, 80);
    if (!url.startsWith("https://") || url.length > 300)
      throw badRequest("the source must be an https URL of at most 300 characters");

    // The allowlist is the contract's, read from the contract.
    const cfg = await chain().getConfig();
    const allow = (cfg["anchor_allowlist"] as string[]) ?? [];
    const host = new URL(url).hostname.toLowerCase();
    if (!allow.some((h) => host === h || host.endsWith(`.${h}`))) {
      throw badRequest(
        allow.length === 0
          ? "this deployment has no independent sources allowlisted, so VERIFIED is not reachable here"
          : `${host} is not an allowlisted independent source`,
        { allowlist: allow },
      );
    }

    let fetched: string;
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0 autocourt" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      fetched = (await res.text()).slice(0, FETCH_CAP);
    } catch (e) {
      throw badRequest(
        `we could not read that source just now (${String(
          (e as Error)?.message ?? e,
        ).slice(0, 80)}) — the validators would not be able to either`,
      );
    }
    if (!fetched.trim()) throw badRequest("that source returned nothing");
    const expected = sha(fetched);

    // Everything from here holds the record's row. Unlocked, a double
    // click added the source twice and — because each request found no
    // CREATE queued yet — put the record on chain twice, one copy an
    // orphan paid for in fees. The state is checked again under the lock:
    // the fetch above takes seconds, and the packet may have been sealed
    // while it ran.
    const item = await withRecordLock(id, async (db) => {
      const fresh = await db.assessment.findUniqueOrThrow({
        where: { id },
        select: { state: true },
      });
      if (fresh.state !== "DRAFT") {
        throw conflict(
          `independent sources enter before submission (state: ${fresh.state})`,
        );
      }
      // One reading per source. The contract fetches the page itself; a
      // second copy is the same document counted again, not corroboration.
      const already = await db.evidenceItem.findFirst({
        where: { assessmentId: id, lane: "ANCHOR", anchorUrl: url },
        select: { evidenceId: true },
      });
      if (already) {
        throw conflict(
          `this source is already on the record as ${already.evidenceId}`,
        );
      }

      const count = await db.evidenceItem.count({ where: { assessmentId: id } });
      const evidenceId = `E-${String(count + 1).padStart(3, "0")}`;
      const created = await db.evidenceItem.create({
        data: {
          assessmentId: id,
          evidenceId,
          uploaderId: user.id,
          uploaderRole: role,
          lane: "ANCHOR",
          declaredClass: "EXTERNAL_SOURCE_RESULT",
          declaredLabel,
          mimeType: "text/plain",
          fileSha256: expected,
          // Placeholders until the chain says what it actually stored:
          // the contract normalizes and hashes the bytes IT fetched.
          textSha256: expected,
          extractorVersion: "anchor-inline-1",
          // App-side only, never a contract value: this item is on its
          // way to the chain and has no verdict-bearing status yet.
          status: "PENDING_ENTRY",
          anchorUrl: url,
          // An anchor is not a party's document, so there is nothing for
          // a party to consent to publishing or to attest to.
          consentedAt: new Date(),
          extraction: {
            create: {
              status: "EXTRACTED",
              normalizedText: fetched.split(/\s+/).join(" ").slice(0, 6_000),
            },
          },
        },
        include: { extraction: true },
      });

      // The contract must know this assessment before a write can address
      // it — an anchor may be the FIRST thing that puts it on chain.
      await ensureCreateJob(id, db);
      await enqueueJob(id, "SUBMIT_ANCHOR", {
        itemJson: JSON.stringify({
          evidence_id: evidenceId,
          declared_class: "EXTERNAL_SOURCE_RESULT",
          declared_label: declaredLabel,
          url,
          expected_sha256: expected,
        }),
      }, db);
      return created;
    });

    await audit(
      user.id,
      "ANCHOR_ADDED",
      { evidenceId: item.evidenceId, url, expected },
      item.id,
    );
    return Response.json({ item, expected }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
