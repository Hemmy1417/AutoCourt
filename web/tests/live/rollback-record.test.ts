/**
 * A possible odometer rollback, on the deployment of record.
 *
 *   AUTOCOURT_LIVE=1 npx vitest run tests/live/rollback-record.test.ts
 *
 * The seller lists a 2003 Honda Accord at 87,432 miles and uploads a March
 * service invoice with that reading typed in. A buyer's wallet uploads an
 * auction export dated May, two months LATER, whose odometer reads 62,000,
 * and disputes the mileage claim in its own name.
 *
 * What is decided where:
 *
 *   CODE   the mileage conflict: a later-dated reading materially lower than
 *          an earlier one, computed from the typed readings by every
 *          validator, with no model asked
 *   PANEL  whether the record itself explains the lower reading (an odometer
 *          replacement documented, a unit corrected); saying it does needs a
 *          quote that grounds in the record
 *   CODE   the rollback flag: an unexplained conflict whose readings come
 *          from two different wallets, and the headline it takes
 *
 * The documents are the ones that produced this outcome on the earlier
 * deployment; the wallets, the signatures and the chain are new.
 */
import { describe, expect, it } from "vitest";

import { getItem, getRecord, getRun } from "../../lib/read";
import { LIVE, Receipts, adjudicate, dispute, fundedWallet, logger, openRecord, seal, upload } from "./helpers";

const VIN = "1HGCM82633A004352";
const log = logger("rollback");

const INVOICE =
  "SERVICE INVOICE 2026-03-07. Vehicle VIN 1HGCM82633A004352. Odometer " +
  "reading 87,432 miles at service. Replaced front brake pads and rotors. " +
  "Coolant flush completed. Next service due at 92,000 miles.";
const AUCTION =
  "AUCTION LISTING EXPORT 2026-05-01. Lot 214. Odometer shows 62,000 " +
  "miles at photography. Sold with minor cosmetic wear noted.";

describe.skipIf(!LIVE)("a later, lower odometer reading from a second wallet", () => {
  it("raises the mileage conflict in code and the rollback headline", { timeout: 45 * 60_000 }, async () => {
    const receipts = new Receipts(log);
    const seller = await fundedWallet("seller", log);
    const buyer = await fundedWallet("buyer", log);

    const id = await openRecord(seller, { vin: VIN, make: "Honda", model: "Accord", year: 2003 }, [{ type: "MILEAGE", declared_value: "87,432 miles" }], receipts);
    log(`record ${id}`);
    let record = (await getRecord(id, true))!;
    expect(record.identity_status).toBe("CONFIRMED");

    const invoice = await upload(
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
    const auction = await upload(
      buyer,
      id,
      {
        declared_class: "VEHICLE_HISTORY_RECORD",
        label: "Auction export",
        text: AUCTION,
        observations: [{ doc_date: "2026-05-01", odometer_reading: 62000, odometer_unit: "MILES", source_field: "listing odometer" }],
        capture_date: "2026-05-01",
      },
      receipts,
      "auction",
    );
    await dispute(buyer, id, ["CL-01"], "The auction odometer is far below the declared figure.", receipts, "dispute");

    record = (await getRecord(id, true))!;
    expect(record.items.find((i) => i.evidence_id === invoice)).toMatchObject({ uploader_account: seller.address, uploader_role: "SELLER" });
    expect(record.items.find((i) => i.evidence_id === auction)).toMatchObject({ uploader_account: buyer.address, uploader_role: "BUYER" });
    expect(record.disputes.map((d) => d.account)).toEqual([buyer.address]);
    // The readings the code compares are the typed rows, each in its uploader's name.
    const rows = [...(await getItem(id, invoice, true))!.observations, ...(await getItem(id, auction, true))!.observations];
    expect(rows.map((r) => [r.doc_date, r.odometer_reading, r.uploader_account])).toEqual([
      ["2026-03-07", 87432, seller.address],
      ["2026-05-01", 62000, buyer.address],
    ]);

    await seal(seller, id, receipts);
    await adjudicate(buyer, id, receipts, "adjudicate");

    const run = (await getRun(id, 1))!;
    const claim = run.report.claims[0]!;
    const explanations = (run as unknown as { explanations?: Record<string, string> }).explanations ?? {};
    log(
      `run 1: rollup ${run.report.rollup} · flags ${JSON.stringify(run.report.flags)} · explanations ${JSON.stringify(explanations)} · ` +
        `${claim.claim_id} ${claim.verdict} ${claim.confidence} support [${claim.support_classes}] contradict [${claim.contradict_classes}]`,
    );
    expect(run.report.flags.mileage_conflict).toBe(true);
    expect(explanations["MC-01"]).toBe("NOT_EXPLAINED");
    expect(run.report.flags.odometer_rollback_indicated).toBe(true);
    expect(run.report.rollup).toBe("POSSIBLE_ODOMETER_ROLLBACK");
    // Neither side's own paperwork can verify the claim or convict the seller.
    expect(claim.verdict).not.toBe("VERIFIED");
    expect(claim.verdict).not.toBe("CLAIM_CONTRADICTED");
    log(`receipts ${JSON.stringify(receipts.hashes)}`);
  });
});
