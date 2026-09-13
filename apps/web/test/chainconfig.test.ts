/**
 * The contract's bounds have ONE source: the contract.
 *
 * The screen used to carry its own copy of the run limit. That is fine
 * until a redeploy changes the constant, at which point the app quietly
 * tells users a number the chain will not honour. These tests pin the
 * three properties that keep the copy honest: read it from the contract,
 * keep it only for the deployment it came from, and say "unknown" rather
 * than guess when the read fails.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getConfig = vi.fn();
let address = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

vi.mock("../lib/chain.js", () => ({
  chain: () => ({
    get address() {
      return address;
    },
    getConfig,
  }),
}));

async function fresh() {
  vi.resetModules();
  return import("../lib/chainconfig.js");
}

beforeEach(() => {
  getConfig.mockReset();
  address = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
});

describe("maxRunsPerAssessment", () => {
  it("reads the limit from the contract", async () => {
    getConfig.mockResolvedValue({ max_runs_per_assessment: 4 });
    const { maxRunsPerAssessment } = await fresh();
    expect(await maxRunsPerAssessment()).toBe(4);
  });

  it("reports whatever the contract says, not a remembered 4", async () => {
    getConfig.mockResolvedValue({ max_runs_per_assessment: 7 });
    const { maxRunsPerAssessment } = await fresh();
    expect(await maxRunsPerAssessment()).toBe(7);
  });

  it("reads once per deployment — the constants cannot change under it", async () => {
    getConfig.mockResolvedValue({ max_runs_per_assessment: 4 });
    const { maxRunsPerAssessment } = await fresh();
    await maxRunsPerAssessment();
    await maxRunsPerAssessment();
    await maxRunsPerAssessment();
    expect(getConfig).toHaveBeenCalledTimes(1);
  });

  it("re-reads when the contract address changes", async () => {
    getConfig.mockResolvedValue({ max_runs_per_assessment: 4 });
    const { maxRunsPerAssessment } = await fresh();
    expect(await maxRunsPerAssessment()).toBe(4);

    address = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    getConfig.mockResolvedValue({ max_runs_per_assessment: 6 });
    expect(await maxRunsPerAssessment()).toBe(6);
    expect(getConfig).toHaveBeenCalledTimes(2);
  });

  it("answers null when the contract cannot be reached", async () => {
    getConfig.mockRejectedValue(new Error("rpc down"));
    const { maxRunsPerAssessment } = await fresh();
    expect(await maxRunsPerAssessment()).toBeNull();
  });

  it("never caches a failure — the next caller retries", async () => {
    getConfig.mockRejectedValueOnce(new Error("rpc down"));
    getConfig.mockResolvedValue({ max_runs_per_assessment: 4 });
    const { maxRunsPerAssessment } = await fresh();
    expect(await maxRunsPerAssessment()).toBeNull();
    expect(await maxRunsPerAssessment()).toBe(4);
  });

  it("treats a nonsense limit as unknown rather than enforcing it", async () => {
    for (const value of [0, -1, 2.5, "4", null, undefined]) {
      getConfig.mockResolvedValue({ max_runs_per_assessment: value });
      const { maxRunsPerAssessment } = await fresh();
      expect(await maxRunsPerAssessment()).toBeNull();
    }
  });
});
