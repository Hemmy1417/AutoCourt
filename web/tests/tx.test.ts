import { describe, expect, it, vi } from "vitest";

import type { TxFinalityView } from "../lib/read";
import { SIMULATION_ATTEMPTS, contractRefusal, stageClass, writeAndConfirm, type TxProgress } from "../lib/tx";

const HASH = `0x${"ab".repeat(32)}`;
const FEES = { distribution: { leaderTimeout: 1n }, feeValue: 5n * 10n ** 16n };

/** A refused simulation exactly as Studio Next returns it: base64 of one tag byte then the sentence. */
function refusal(sentence: string) {
  const bytes = new TextEncoder().encode(String.fromCharCode(1) + sentence);
  const b64 = btoa(String.fromCharCode(...bytes));
  return Object.assign(new Error("Invalid input: double check your parameters"), {
    cause: { code: -32000, message: "execution failed", data: { receipt: { execution_result: "ERROR", result: b64 } } },
  });
}

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    estimateTransactionFeesForWrite: vi.fn(async () => FEES),
    estimateTransactionFees: vi.fn(async () => FEES),
    writeContract: vi.fn(async () => HASH),
    ...overrides,
  };
}

const status = (v: Partial<TxFinalityView>): TxFinalityView => ({ statusName: "ACCEPTED", finalized: false, executed: "UNKNOWN", ...v });

async function run(client: ReturnType<typeof fakeClient>, opts: Partial<Parameters<typeof writeAndConfirm>[0]> = {}) {
  const stages: TxProgress[] = [];
  const outcome = await writeAndConfirm({
    client,
    address: "0x0000000000000000000000000000000000000001",
    functionName: "record_dispute",
    args: ["ac-000001"],
    predicate: async () => true,
    onProgress: (p) => stages.push(p),
    pollMs: 0,
    finalityTries: 2,
    txStatus: async () => status({ statusName: "FINALIZED", finalized: true, executed: "SUCCESS" }),
    ...opts,
  }).then(
    (hash) => ({ hash, error: null as unknown }),
    (error) => ({ hash: "", error }),
  );
  // Let the finality watch report.
  await new Promise((r) => setTimeout(r, 5));
  return { stages, ...outcome };
}

describe("a write the contract refuses", () => {
  it("stops in the simulation with the contract's own sentence, and sends nothing", async () => {
    const client = fakeClient({
      estimateTransactionFeesForWrite: vi.fn(async () => {
        throw refusal("[EXPECTED] the seller of record cannot dispute their own claims");
      }),
    });
    const { stages, error } = await run(client);
    expect(error).toBeTruthy();
    expect(client.writeContract).not.toHaveBeenCalled();
    const last = stages.at(-1)!;
    expect(last.stage).toBe("failed");
    expect(last.at).toBe("estimating");
    expect(last.detail).toContain("the seller of record cannot dispute their own claims");
    expect(last.detail).not.toContain("[EXPECTED]");
  });

  it("reads the refusal from where viem buries it", () => {
    expect(contractRefusal(refusal("[EXPECTED] unknown assessment"))).toBe("[EXPECTED] unknown assessment");
    expect(contractRefusal(new Error("network down"))).toBeNull();
  });

  it("reports a refusal that finalized on chain instead of waiting forever", async () => {
    const { stages, error } = await run(fakeClient(), {
      predicate: async () => false,
      predicateTries: 6,
      txStatus: async () => status({ statusName: "FINALIZED", finalized: true, executed: "ERROR" }),
    });
    expect(error).toBeTruthy();
    expect(stages.at(-1)).toMatchObject({ stage: "failed", at: "pending", hash: HASH });
  });

  it("names a round the validators could not agree on", async () => {
    const { stages } = await run(fakeClient(), {
      predicate: async () => false,
      predicateTries: 6,
      txStatus: async () => status({ statusName: "UNDETERMINED" }),
    });
    expect(stages.at(-1)!.detail).toMatch(/did not reach agreement/);
  });
});

describe("sizing the fee", () => {
  it("prices a panel round with the plain estimate, never by simulating it", async () => {
    const client = fakeClient();
    await run(client, { simulate: false });
    expect(client.estimateTransactionFeesForWrite).not.toHaveBeenCalled();
    expect(client.estimateTransactionFees).toHaveBeenCalledOnce();
  });

  it("falls back to the plain estimate when a simulation fails for a reason that is not the contract's", async () => {
    const client = fakeClient({
      estimateTransactionFeesForWrite: vi.fn(async () => {
        throw new Error("simulation is not available for this method");
      }),
    });
    const { hash } = await run(client);
    expect(hash).toBe(HASH);
    expect(client.estimateTransactionFeesForWrite).toHaveBeenCalledOnce();
    expect(client.estimateTransactionFees).toHaveBeenCalledOnce();
  });

  it("asks a simulation the network dropped again, and stops on the refusal it then returns", async () => {
    let calls = 0;
    const client = fakeClient({
      estimateTransactionFeesForWrite: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error("fetch failed");
        throw refusal("[EXPECTED] only the seller of record can seal the packet");
      }),
    });
    const { stages, error } = await run(client);
    expect(error).toBeTruthy();
    expect(client.estimateTransactionFeesForWrite).toHaveBeenCalledTimes(2);
    expect(client.estimateTransactionFees).not.toHaveBeenCalled();
    expect(client.writeContract).not.toHaveBeenCalled();
    expect(stages.at(-1)).toMatchObject({ stage: "failed", at: "estimating" });
    expect(stages.at(-1)!.detail).toContain("only the seller of record can seal the packet");
  });

  it("prices the write without the simulation only after the network dropped it every time", async () => {
    const client = fakeClient({
      estimateTransactionFeesForWrite: vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    });
    const { hash } = await run(client);
    expect(client.estimateTransactionFeesForWrite).toHaveBeenCalledTimes(SIMULATION_ATTEMPTS);
    expect(client.estimateTransactionFees).toHaveBeenCalledOnce();
    expect(hash).toBe(HASH);
  });

  it("never sends a zero deposit", async () => {
    const client = fakeClient({ estimateTransactionFees: vi.fn(async () => ({ ...FEES, feeValue: 0n })) });
    await run(client, { simulate: false });
    const sent = (client.writeContract.mock.calls[0] as unknown as [{ fees: { feeValue: bigint } }])[0];
    expect(sent.fees.feeValue).toBe(10n ** 15n);
  });
});

describe("a write that lands", () => {
  it("walks every stage and only then says finalized", async () => {
    let polls = 0;
    const { stages, hash } = await run(fakeClient(), { predicate: async () => ++polls >= 2 });
    expect(hash).toBe(HASH);
    expect(stages.map((s) => s.stage)).toEqual(["estimating", "wallet", "submitted", "pending", "accepted", "confirmed"]);
  });

  it("does not claim finality it never saw", async () => {
    const { stages } = await run(fakeClient(), { txStatus: async () => status({ statusName: "ACCEPTED" }) });
    expect(stages.at(-1)!.stage).toBe("accepted");
    expect(stages.some((s) => s.stage === "confirmed")).toBe(false);
  });

  it("reports a declined signature as declined", async () => {
    const client = fakeClient({
      writeContract: vi.fn(async () => {
        throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      }),
    });
    const { stages } = await run(client);
    expect(stages.at(-1)).toMatchObject({ stage: "rejected", at: "wallet" });
  });
});

describe("the stepper", () => {
  it("paints a failure on the stage it happened at", () => {
    expect(stageClass("estimating", "failed", "estimating")).toBe("txstep fail");
    expect(stageClass("wallet", "failed", "estimating")).toBe("txstep");
    expect(stageClass("estimating", "failed", "pending")).toBe("txstep done");
  });
});
