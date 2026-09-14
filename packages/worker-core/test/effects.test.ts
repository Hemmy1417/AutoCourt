/**
 * The rule that a refused attempt must not bury a verdict that stands.
 *
 * Found live on ac-000019: two adjudication requests a millisecond
 * apart both reached the chain, the contract refused the second as
 * "already judged this exact packet", and recording that refusal set the
 * record's state to FAILED — over a verdict that was perfectly good.
 * It survived only because the effects pass happened to process the
 * failed job before the successful one, on a query with no ORDER BY.
 *
 * The harm is not cosmetic: an appeal needs a standing verdict, so a
 * record stuck at FAILED cannot be appealed by anyone.
 */
import { describe, expect, it } from "vitest";

import { stateAfterFailedAdjudication } from "../src/effects.js";

describe("a failed adjudication attempt", () => {
  it("leaves a record that already holds a verdict ADJUDICATED", () => {
    expect(stateAfterFailedAdjudication(true)).toBe("ADJUDICATED");
  });

  it("marks a record with no verdict behind it FAILED", () => {
    expect(stateAfterFailedAdjudication(false)).toBe("FAILED");
  });

  it("never reports FAILED while a run stands — the appeal gate depends on it", () => {
    // Stated as the property rather than the branch: whatever else this
    // function grows, a standing run must never come back as FAILED.
    for (const hasStandingRun of [true, false])
      expect(stateAfterFailedAdjudication(hasStandingRun) === "FAILED").toBe(
        !hasStandingRun,
      );
  });
});
