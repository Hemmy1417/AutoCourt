/**
 * The job queue's ordering, failure and retry rules, against a real
 * PostgreSQL — the properties live in the queries, so a mock proves
 * nothing about them.
 *
 * The chain is a stub that records every call. Each test builds its own
 * record, and the whole file runs in a throwaway schema: a drain pass
 * takes every PENDING job it can see.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@autocourt/db";
import type { AutoCourtChain, TxStatus } from "@autocourt/genlayer-client";

import { hasDatabase, isolateDatabase } from "../../../tests/support/isolated-db.js";

const SUCCESS: TxStatus = { status: "FINALIZED", leaderResult: "SUCCESS" };
const NO_CONSENSUS: TxStatus = { status: "UNDETERMINED" };
const refused = (sentence: string): TxStatus => ({
  status: "FINALIZED",
  leaderResult: "ERROR",
  refusalText: sentence,
});

describe.skipIf(!hasDatabase)("the job queue, against a real database", () => {
  let schema = "";
  let prisma: PrismaClient;
  let runPendingJobs: typeof import("../src/index.js").runPendingJobs;
  let recordJobEffects: typeof import("../src/index.js").recordJobEffects;

  beforeAll(async () => {
    schema = isolateDatabase("queue");
    ({ prisma } = await import("@autocourt/db"));
    ({ runPendingJobs, recordJobEffects } = await import("../src/index.js"));
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.adjudicationRun.deleteMany();
    await prisma.job.deleteMany();
  });

  /** A record already on chain, in the given state. */
  async function record(state: string) {
    const n = Math.random().toString(16).slice(2, 12);
    const seller = await prisma.user.create({
      data: { walletAddress: `0x${n.padEnd(40, "0")}` },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        vin: "1HGCM82633A004352", vinCheckDigitOk: true,
        make: "Honda", model: "Accord", year: 2003, sellerId: seller.id,
      },
    });
    return prisma.assessment.create({
      data: {
        vehicleId: vehicle.id, state, packetVersion: 1,
        onChainId: `ac-${n}`, contractAddress: "0xstub",
      },
    });
  }

  const T0 = Date.UTC(2026, 8, 14, 12, 0, 0);
  function job(
    assessmentId: string,
    kind: string,
    atMs: number,
    extra: Record<string, unknown> = {},
  ) {
    return prisma.job.create({
      data: { assessmentId, kind, createdAt: new Date(T0 + atMs), ...extra },
    });
  }

  const reload = (id: string) => prisma.job.findUniqueOrThrow({ where: { id } });

  /** Writes answer 0x<kind><n>; finality is whatever `outcome` says. */
  function stubChain(
    outcome: (hash: string) => TxStatus = () => SUCCESS,
    verdict: Record<string, unknown> = { standing_run: 1 },
  ) {
    const calls: string[] = [];
    let n = 0;
    const write = (kind: string) => async () => {
      n += 1;
      calls.push(kind);
      return { txHash: `0x${kind.toLowerCase()}${n}` };
    };
    const client = {
      address: "0xstub",
      createAssessment: write("CREATE"),
      submitEvidenceText: write("SUBMIT_EVIDENCE"),
      submitAnchorItem: write("SUBMIT_ANCHOR"),
      recordDispute: write("RECORD_DISPUTE"),
      sealAssessment: write("SEAL"),
      submitAppealEvidence: write("SUBMIT_APPEAL_EVIDENCE"),
      adjudicate: write("ADJUDICATE"),
      readjudicate: write("READJUDICATE"),
      waitFinality: async (hash: string) => {
        calls.push(`poll ${hash}`);
        return outcome(hash);
      },
      getVerdict: async () => verdict,
      getStats: async () => ({ assessments: 0 }),
      getAssessment: async () => {
        throw new Error("no such record");
      },
    };
    return { calls, chain: client as unknown as AutoCourtChain };
  }

  describe("ordering", () => {
    it("never lets a job overtake an earlier one still in flight", async () => {
      const a = await record("DRAFT");
      await job(a.id, "SUBMIT_EVIDENCE", 0, { txHash: "0xinflight" });
      const seal = await job(a.id, "SEAL", 1_000);
      const { calls, chain } = stubChain((h) =>
        h === "0xinflight" ? { status: "PENDING" } : SUCCESS,
      );

      await runPendingJobs({ chain });

      expect(calls).not.toContain("SEAL");
      expect((await reload(seal.id)).state).toBe("PENDING");
    });

    it("keeps insertion order for two jobs stamped in the same millisecond", async () => {
      const a = await record("DRAFT");
      await job(a.id, "SUBMIT_EVIDENCE", 0, { id: "job-a", txHash: "0xinflight" });
      await job(a.id, "SEAL", 0, { id: "job-b" });
      const { calls, chain } = stubChain((h) =>
        h === "0xinflight" ? { status: "PENDING" } : SUCCESS,
      );

      await runPendingJobs({ chain });

      expect(calls).not.toContain("SEAL");
    });
  });

  describe("a step that fails", () => {
    it("fails the steps queued behind it, without spending a transaction on them", async () => {
      const a = await record("SUBMITTED");
      await job(a.id, "SEAL", 0);
      const adjudicate = await job(a.id, "ADJUDICATE", 1_000);
      const { calls, chain } = stubChain((h) =>
        h.startsWith("0xseal")
          ? refused("[EXPECTED] sealing requires at least one evidence item")
          : SUCCESS,
      );

      await runPendingJobs({ chain });

      const after = await reload(adjudicate.id);
      expect(after.state).toBe("FAILED");
      expect(after.lastError).toMatch(/earlier step failed \(SEAL\)/);
      expect(calls).not.toContain("ADJUDICATE");
    });

    it("still records a buyer's dispute queued behind it — a dispute depends on nothing but the record", async () => {
      const a = await record("PROCESSING");
      await job(a.id, "ADJUDICATE", 0);
      const dispute = await job(a.id, "RECORD_DISPUTE", 1_000);
      const { calls, chain } = stubChain((h) =>
        h.startsWith("0xadjudicate") ? NO_CONSENSUS : SUCCESS,
      );

      await runPendingJobs({ chain });

      expect((await reload(dispute.id)).state).toBe("DONE");
      expect(calls).toContain("RECORD_DISPUTE");
    });

    it("is not failed by a refused dispute ahead of it — the seal does not depend on the stake", async () => {
      const a = await record("SUBMITTED");
      await job(a.id, "RECORD_DISPUTE", 0);
      const seal = await job(a.id, "SEAL", 1_000);
      const { chain } = stubChain((h) =>
        h.startsWith("0xrecord_dispute")
          ? refused("[EXPECTED] at most 3 disputing accounts")
          : SUCCESS,
      );

      await runPendingJobs({ chain });

      expect((await reload(seal.id)).state).toBe("DONE");
    });

    it("does not poison the record: a retry queued after the failure is judged", async () => {
      // FAILED is retryable by either party. A retry that is failed on
      // arrival because an old attempt failed would make that promise
      // false — and would take every later appeal down with it.
      const a = await record("PROCESSING");
      await job(a.id, "ADJUDICATE", 0, {
        state: "FAILED", txHash: "0xold", lastError: "UNDETERMINED",
      });
      const retry = await job(a.id, "ADJUDICATE", 60_000);
      const { calls, chain } = stubChain();

      await runPendingJobs({ chain });

      const after = await reload(retry.id);
      expect(after.lastError).toBe("");
      expect(after.state).toBe("DONE");
      expect(calls).toContain("ADJUDICATE");
    });
  });

  describe("retries", () => {
    it("retries a write that ended without consensus as a NEW attempt, with its own hash", async () => {
      const a = await record("DRAFT");
      const evidence = await job(a.id, "SUBMIT_EVIDENCE", 0);
      const { calls, chain } = stubChain((h) =>
        h === "0xsubmit_evidence1" ? NO_CONSENSUS : SUCCESS,
      );

      await runPendingJobs({ chain });
      await runPendingJobs({ chain });

      expect(calls.filter((c) => c === "SUBMIT_EVIDENCE")).toHaveLength(2);
      const after = await reload(evidence.id);
      expect(after.state).toBe("DONE");
      expect(after.txHash).toBe("0xsubmit_evidence2");
    });

    it("never resubmits while the chain has not answered — a lost response is not a refusal", async () => {
      const a = await record("DRAFT");
      await job(a.id, "SUBMIT_EVIDENCE", 0);
      const { calls, chain } = stubChain((h) =>
        h === "0xsubmit_evidence1" ? { status: "UNKNOWN" } : SUCCESS,
      );

      await runPendingJobs({ chain });
      await runPendingJobs({ chain });

      expect(calls.filter((c) => c === "SUBMIT_EVIDENCE")).toHaveLength(1);
    });

    it("does not count an unreadable poll as an attempt — the write may well have landed", async () => {
      const a = await record("DRAFT");
      const evidence = await job(a.id, "SUBMIT_EVIDENCE", 0);
      let polls = 0;
      const { calls, chain } = stubChain(() => {
        polls += 1;
        if (polls <= 3) throw new Error("fetch failed");
        return SUCCESS;
      });

      for (let pass = 0; pass < 4; pass++) await runPendingJobs({ chain });

      const after = await reload(evidence.id);
      expect(after.state).toBe("DONE");
      expect(after.attempts).toBe(0);
      expect(calls.filter((c) => c === "SUBMIT_EVIDENCE")).toHaveLength(1);
    });

    it("gives up after its attempts, keeping the last hash and failing what was queued behind", async () => {
      const a = await record("DRAFT");
      const evidence = await job(a.id, "SUBMIT_EVIDENCE", 0);
      const seal = await job(a.id, "SEAL", 1_000);
      const { calls, chain } = stubChain((h) =>
        h.startsWith("0xsubmit_evidence") ? NO_CONSENSUS : SUCCESS,
      );

      for (let pass = 0; pass < 3; pass++) await runPendingJobs({ chain });

      const after = await reload(evidence.id);
      expect(after.state).toBe("FAILED");
      expect(after.txHash).toBe("0xsubmit_evidence3");
      expect((await reload(seal.id)).state).toBe("FAILED");
      expect(calls).not.toContain("SEAL");
    });

    it("does not re-run a judgment on its own — that is the parties' call, and the attempt keeps its hash", async () => {
      const a = await record("SUBMITTED");
      const adjudicate = await job(a.id, "ADJUDICATE", 0);
      const { calls, chain } = stubChain(() => NO_CONSENSUS);

      await runPendingJobs({ chain });
      await runPendingJobs({ chain });

      const after = await reload(adjudicate.id);
      expect(after.state).toBe("FAILED");
      expect(after.txHash).toBe("0xadjudicate1");
      expect(calls.filter((c) => c === "ADJUDICATE")).toHaveLength(1);
    });
  });

  describe("recording a verdict", () => {
    it("stores the panel's words byte for byte, in any script", async () => {
      // Found live on ac-000020: a verdict carrying a non-breaking hyphen
      // (U+2011) could not be cached on a database whose encoding was the
      // Windows code page. The effects pass failed on every attempt, and
      // the record sat at PROCESSING with its verdict already on chain.
      const words = "long‑standing gaps — Überprüfung · 検査記録 · ✓";
      const a = await record("PROCESSING");
      await job(a.id, "ADJUDICATE", 0, { state: "DONE", txHash: "0xjudged" });
      const { chain } = stubChain(() => SUCCESS, { standing_run: 1, summary: words });
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

      await recordJobEffects(chain);

      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
      const run = await prisma.adjudicationRun.findFirstOrThrow({
        where: { assessmentId: a.id },
      });
      expect(JSON.parse(run.reportJson).summary).toBe(words);
      expect((await prisma.assessment.findUniqueOrThrow({ where: { id: a.id } })).state)
        .toBe("ADJUDICATED");
    });
  });

  describe("recording a failed adjudication", () => {
    it("records an attempt with no transaction hash once, however many passes run", async () => {
      const a = await record("PROCESSING");
      await job(a.id, "ADJUDICATE", 0, {
        state: "FAILED",
        lastError: "an earlier step failed (SEAL), so this one cannot run",
      });
      const { chain } = stubChain();
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

      await recordJobEffects(chain);
      await recordJobEffects(chain);
      await recordJobEffects(chain);

      expect(await prisma.adjudicationRun.count({ where: { assessmentId: a.id } })).toBe(1);
      // The unique index would also refuse a second row — but by throwing
      // on every pass, into a log an operator reads. Nothing new to record
      // must mean nothing said.
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    });

    it("never overwrites a retry already in flight with an old failure", async () => {
      const a = await record("PROCESSING");
      await job(a.id, "ADJUDICATE", 0, {
        state: "FAILED", lastError: "submission failed: fetch failed",
      });
      const { chain } = stubChain();
      await recordJobEffects(chain);
      const state = async () =>
        (await prisma.assessment.findUniqueOrThrow({ where: { id: a.id } })).state;
      expect(await state()).toBe("FAILED");

      // a party retries: the route claims the record and queues a new attempt
      await prisma.assessment.update({ where: { id: a.id }, data: { state: "PROCESSING" } });
      await job(a.id, "ADJUDICATE", 60_000);
      await recordJobEffects(chain);

      expect(await state()).toBe("PROCESSING");
    });
  });
});
