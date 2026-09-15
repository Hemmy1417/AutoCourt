/**
 * A record settles: four runs at most, on the deployment of record.
 *
 *   AUTOCOURT_LIVE=1 npx vitest run tests/live/run-limit.test.ts
 *
 * Without a bound, a party who dislikes a verdict could keep asking until a
 * panel drifts their way. The contract allows one adjudication and three
 * appeals, and every appeal needs something new on the record. This drives
 * one record to the limit and checks every place the bound has to hold:
 *
 *   RE-ROLL    asking the panel again over the SAME packet is refused on
 *              chain: a second look is only reachable as an appeal
 *   APPEALS    runs 2, 3 and 4, each after a fresh dispute, appealed by the
 *              buyer, the seller and the buyer in their own names
 *   THE APP    at the limit the appeal is offered to no one, with the
 *              contract's reason in words
 *   THE CHAIN  with a fresh dispute on the record, so the limit is the only
 *              thing in the way, a fifth run sent straight to the chain is
 *              refused in the contract's words
 *   HISTORY    run 1 reads back byte for byte after run 4
 */
import { describe, expect, it } from "vitest";

import { actsFor } from "../../lib/acts";
import { call, getConfig, getRecord, getRun, getVerdict } from "../../lib/read";
import { LIVE, Receipts, adjudicate, appeal, dispute, fundedWallet, logger, openRecord, refusedOnChain, seal, upload } from "./helpers";

const VIN = "1HGCM82633A004352";
const log = logger("runs");

const INVOICE =
  "SERVICE INVOICE 2026-03-07. Vehicle VIN 1HGCM82633A004352. Odometer " +
  "reading 87,432 miles at service. Replaced front brake pads and rotors. " +
  "Next service due at 92,000 miles.";

const rawRun = (id: string, n: number) => call<string>("get_run", [id, n], (raw) => raw, 0, true);

describe.skipIf(!LIVE)("a record at the contract's run limit", () => {
  it("refuses a re-roll and a fifth run, and keeps every earlier run", { timeout: 60 * 60_000 }, async () => {
    const receipts = new Receipts(log);
    const seller = await fundedWallet("seller", log);
    const buyer = await fundedWallet("buyer", log);
    const config = await getConfig();
    expect(config.max_runs_per_assessment).toBe(4);

    const id = await openRecord(seller, { vin: VIN, make: "Honda", model: "Accord", year: 2003 }, [{ type: "MILEAGE", declared_value: "87,432 miles" }], receipts);
    log(`record ${id}`);
    expect((await getRecord(id, true))!.identity_status).toBe("CONFIRMED");
    await upload(
      seller,
      id,
      {
        declared_class: "SERVICE_INVOICE",
        label: "March service invoice",
        text: INVOICE,
        observations: [{ doc_date: "2026-03-07", odometer_reading: 87432, odometer_unit: "MILES", source_field: "odometer line" }],
        capture_date: "2026-03-07",
      },
      receipts,
      "invoice",
    );
    await seal(seller, id, receipts);

    // Run 1, then the re-roll the contract refuses.
    await adjudicate(seller, id, receipts, "run-1");
    const run1 = await rawRun(id, 1);
    expect(JSON.parse(run1)).toMatchObject({ run: 1, kind: "ADJUDICATION", packet_version: 1 });
    const reroll = await refusedOnChain(seller, "adjudicate", [id], log);
    expect(reroll.executed).toBe("ERROR");
    expect(reroll.sentence).toBe("[EXPECTED] run 1 already judged this exact packet; a re-judgment is an appeal (readjudicate)");
    expect((await getRecord(id, true))!.runs_count).toBe(1);

    // Runs 2 to 4: something new each time, then an appeal in the appellant's own name.
    const appellants = { 2: buyer, 3: seller, 4: buyer } as const;
    for (const n of [2, 3, 4] as const) {
      await dispute(buyer, id, ["CL-01"], `Round ${n}: the mileage is still unconfirmed by any independent record.`, receipts, `dispute-${n}`);
      const who = appellants[n];
      await appeal(who, id, `Appeal ${n}: the declared mileage rests on the seller's own invoice alone.`, receipts, `run-${n}`);
      const run = (await getRun(id, n))!;
      log(`run ${n}: ${run.kind} by ${run.appellant} · rollup ${run.report.rollup} · packet v${run.packet_version}`);
      expect(run).toMatchObject({ run: n, kind: "RE_ADJUDICATION", appellant: who.address, prior_run: n - 1, packet_version: n });
    }

    // At the limit. Something new is on the record, so the limit is the only reason left.
    await dispute(buyer, id, ["CL-01"], "One more look, please.", receipts, "dispute-5");
    const record = (await getRecord(id, true))!;
    expect(record.runs_count).toBe(4);
    for (const who of [seller, buyer]) {
      const act = actsFor(record, config, who.address).find((a) => a.id === "appeal")!;
      expect(act.available).toBe(false);
      expect(act.reason).toBe("the record holds the 4 runs the contract allows, so this verdict is final");
    }
    const fifth = await refusedOnChain(buyer, "readjudicate", [id, buyer.address, "A fifth look at the same record."], log);
    expect(fifth.executed).toBe("ERROR");
    expect(fifth.sentence).toBe("[EXPECTED] the record holds at most 4 runs");

    const after = (await getRecord(id, true))!;
    expect(after.runs_count).toBe(4);
    expect(await rawRun(id, 1)).toBe(run1);
    const verdict = (await getVerdict(id, true))!;
    expect(verdict).toMatchObject({ standing_run: 4, total_runs: 4 });
    log(`refused on chain: re-roll ${reroll.hash} · fifth run ${fifth.hash}`);
    log(`receipts ${JSON.stringify(receipts.hashes)}`);
  });
});
