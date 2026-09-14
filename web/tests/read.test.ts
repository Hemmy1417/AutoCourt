import { afterEach, describe, expect, it, vi } from "vitest";

import { acquireReadSlot, normalizeTxView, READS_PER_MINUTE } from "../lib/read";

describe("transaction status", () => {
  it("reads success from the deciding leader receipt, not the consensus result", () => {
    // Measured shapes: a write that took effect, and one the contract refused.
    expect(
      normalizeTxView({ statusName: "FINALIZED", result_name: "MAJORITY_AGREE", consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }, { execution_result: "ERROR" }] } }),
    ).toEqual({ statusName: "FINALIZED", finalized: true, executed: "SUCCESS" });
    expect(
      normalizeTxView({ statusName: "FINALIZED", result_name: "MAJORITY_AGREE", consensus_data: { leader_receipt: [{ execution_result: "ERROR" }] } }),
    ).toEqual({ statusName: "FINALIZED", finalized: true, executed: "ERROR" });
  });

  it("maps the numeric status the wire can carry", () => {
    expect(normalizeTxView({ status: 7 }).finalized).toBe(true);
    expect(normalizeTxView({ status: 5 }).statusName).toBe("ACCEPTED");
    expect(normalizeTxView(null)).toEqual({ statusName: "UNKNOWN", finalized: false, executed: "UNKNOWN" });
  });
});

describe("read pacing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a tab under the RPC's per-minute bucket, and lets the next read through when the window moves", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < READS_PER_MINUTE; i++) await acquireReadSlot();
    let through = false;
    void acquireReadSlot().then(() => {
      through = true;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(through).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(through).toBe(true);
  });

  it("stays under Studio Next's measured limit of 30 contract reads a minute", () => {
    expect(READS_PER_MINUTE).toBeLessThan(30);
  });
});
