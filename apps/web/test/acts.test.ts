/**
 * S40's own test file: availability as a pure function, statuses × roles,
 * no browser, no chain. An unavailable act must carry its reason.
 */
import { describe, expect, it } from "vitest";

import { actsFor, type ActsInput } from "../lib/acts.js";

const base: ActsInput = {
  state: "DRAFT",
  role: "SELLER",
  evidenceCount: 2,
  unconsentedCount: 0,
  pendingAnchorCount: 0,
  successRuns: 0,
  maxRuns: 4,
  newAppealEvidenceCount: 0,
  freshDisputeCount: 0,
  hasOnChainId: false,
};

const act = (input: Partial<ActsInput>, id: string) =>
  actsFor({ ...base, ...input }).find((a) => a.id === id)!;

describe("every act always renders, available or explained", () => {
  it("every unavailable act carries a reason in words", () => {
    for (const state of ["DRAFT", "SUBMITTED", "PROCESSING", "ADJUDICATED", "FAILED"]) {
      for (const role of ["SELLER", "BUYER"] as const) {
        for (const a of actsFor({ ...base, state, role })) {
          if (!a.available) {
            expect(a.reason, `${state}/${role}/${a.id}`).toBeTruthy();
          }
        }
      }
    }
  });
});

describe("submit gate", () => {
  it("needs seller + draft + evidence + full consent", () => {
    expect(act({}, "submit").available).toBe(true);
    expect(act({ role: "BUYER" }, "submit").reason).toMatch(/only the seller/);
    expect(act({ evidenceCount: 0 }, "submit").reason).toMatch(/at least one/);
    expect(act({ unconsentedCount: 2 }, "submit").reason).toMatch(/consent/);
  });

  it("an independent source still entering the record blocks the seal", () => {
    // Its real hashes are not known until every validator has agreed on
    // the bytes they fetched, so a manifest sealed now would cover a
    // hash the app merely guessed.
    const a = act({ pendingAnchorCount: 1 }, "submit");
    expect(a.available).toBe(false);
    expect(a.reason).toMatch(/independent source/i);
    expect(act({ state: "SUBMITTED" }, "submit").reason).toMatch(/already/);
  });
});

describe("evidence and redaction windows", () => {
  it("upload closes while sealed, reopens for appeals", () => {
    expect(act({ state: "SUBMITTED" }, "upload").reason).toMatch(/sealed/);
    expect(act({ state: "PROCESSING" }, "upload").reason).toMatch(/sealed/);
    expect(act({ state: "ADJUDICATED" }, "upload").available).toBe(true);
    expect(act({ state: "ADJUDICATED" }, "upload").label).toMatch(/appeal/i);
  });

  it("redaction is honest about its impossibility after submission", () => {
    expect(act({ state: "PROCESSING" }, "redact").reason).toMatch(
      /impossible after/,
    );
  });
});

describe("appeal gate", () => {
  it("needs a verdict, run budget, and something new", () => {
    expect(act({ state: "ADJUDICATED" }, "appeal").reason).toMatch(
      /new evidence or a new dispute/,
    );
    expect(
      act({ state: "ADJUDICATED", newAppealEvidenceCount: 1 }, "appeal")
        .available,
    ).toBe(true);
    expect(
      act({ state: "ADJUDICATED", freshDisputeCount: 1 }, "appeal").available,
    ).toBe(true);
    expect(
      act(
        { state: "ADJUDICATED", successRuns: 4, newAppealEvidenceCount: 1 },
        "appeal",
      ).reason,
    ).toMatch(/at most 4 runs/);
  });

  it("an unreadable cap does not deny an appeal the contract might allow", () => {
    // The screen passes Infinity when get_config could not be reached.
    // Inventing a limit here would refuse a legitimate appeal over an
    // RPC hiccup; the contract refuses for itself either way.
    expect(
      act(
        {
          state: "ADJUDICATED",
          successRuns: 9,
          maxRuns: Number.POSITIVE_INFINITY,
          newAppealEvidenceCount: 1,
        },
        "appeal",
      ).available,
    ).toBe(true);
  });
});

describe("role floors in the UI mirror the contract", () => {
  it("a seller cannot dispute; a buyer cannot submit or share", () => {
    expect(act({}, "dispute").reason).toMatch(/cannot dispute their own/);
    expect(act({ role: "BUYER" }, "dispute").available).toBe(true);
    expect(act({ role: "BUYER" }, "share").reason).toMatch(/only the seller/);
  });
});

describe("processing and failure states", () => {
  it("processing blocks adjudicate with the in-flight reason", () => {
    expect(act({ state: "PROCESSING" }, "adjudicate").reason).toMatch(
      /in flight/,
    );
  });

  it("retry appears exactly on FAILED", () => {
    expect(act({ state: "FAILED" }, "retry").available).toBe(true);
    expect(act({}, "retry").available).toBe(false);
  });
});
