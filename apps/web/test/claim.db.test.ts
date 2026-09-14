/**
 * Claims and record locks, against a real PostgreSQL.
 *
 * Every route that moves a record's state used to check the state and
 * then write it in two steps, so two requests a millisecond apart both
 * passed. These pin the two primitives the routes now share. Each runs
 * requests truly concurrently, and the lock test pauses between checking
 * and writing, so an unlocked version loses every time — not only on an
 * unlucky schedule.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@autocourt/db";

import { hasDatabase, isolateDatabase } from "../../../tests/support/isolated-db.js";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!hasDatabase)("claims and record locks, against a real database", () => {
  let schema = "";
  let prisma: PrismaClient;
  let service: typeof import("../lib/service.js");

  beforeAll(async () => {
    schema = isolateDatabase("claim");
    ({ prisma } = await import("@autocourt/db"));
    service = await import("../lib/service.js");
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

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
    return prisma.assessment.create({ data: { vehicleId: vehicle.id, state } });
  }

  const stateOf = async (id: string) =>
    (await prisma.assessment.findUniqueOrThrow({ where: { id } })).state;

  describe("claimAndQueue", () => {
    it("lets exactly one of two simultaneous requests win, and queues only its work", async () => {
      const a = await record("SUBMITTED");
      const request = () =>
        service.claimAndQueue(
          a.id,
          { from: "SUBMITTED", to: "PROCESSING", lost: "an adjudication is already in flight" },
          async (db) => {
            await pause(50);
            return service.enqueueJob(a.id, "ADJUDICATE", {}, db);
          },
        );

      const outcomes = await Promise.allSettled([request(), request()]);

      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      const lost = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
      expect(lost.reason.status).toBe(409);
      expect(lost.reason.message).toBe("an adjudication is already in flight");
      expect(await prisma.job.count({ where: { assessmentId: a.id } })).toBe(1);
      expect(await stateOf(a.id)).toBe("PROCESSING");
    });

    it("gives the claim back when queueing fails — a record is never left where nothing will move it", async () => {
      const a = await record("SUBMITTED");

      await expect(
        service.claimAndQueue(
          a.id,
          { from: "SUBMITTED", to: "PROCESSING", lost: "in flight" },
          async (db) => {
            await service.enqueueJob(a.id, "ADJUDICATE", {}, db);
            throw new Error("the database went away mid-request");
          },
        ),
      ).rejects.toThrow("went away");

      expect(await stateOf(a.id)).toBe("SUBMITTED");
      expect(await prisma.job.count({ where: { assessmentId: a.id } })).toBe(0);
    });

    it("refuses a claim from a state the record is no longer in", async () => {
      const a = await record("ADJUDICATED");

      await expect(
        service.claimAndQueue(
          a.id,
          { from: "SUBMITTED", to: "PROCESSING", lost: "moved on" },
          async () => undefined,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(await stateOf(a.id)).toBe("ADJUDICATED");
    });
  });

  describe("withRecordLock", () => {
    it("serialises writes that check before they insert", async () => {
      const a = await record("DRAFT");
      const addOnce = () =>
        service.withRecordLock(a.id, async (db) => {
          const queued = await db.job.count({
            where: { assessmentId: a.id, kind: "CREATE" },
          });
          await pause(50);
          if (queued === 0) await service.enqueueJob(a.id, "CREATE", {}, db);
        });

      await Promise.all([addOnce(), addOnce()]);

      expect(
        await prisma.job.count({ where: { assessmentId: a.id, kind: "CREATE" } }),
      ).toBe(1);
    });

    it("puts a record on chain once when two sources are added at the same moment", async () => {
      const a = await record("DRAFT");

      await Promise.all([
        service.withRecordLock(a.id, (db) => service.ensureCreateJob(a.id, db)),
        service.withRecordLock(a.id, (db) => service.ensureCreateJob(a.id, db)),
      ]);

      expect(
        await prisma.job.count({ where: { assessmentId: a.id, kind: "CREATE" } }),
      ).toBe(1);
    });

    it("answers 404 for a record that does not exist, rather than running unlocked", async () => {
      await expect(
        service.withRecordLock("no-such-record", async () => "ran"),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
