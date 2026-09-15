/**
 * A trouble code is never an auto-failure, on the deployment of record.
 *
 *   AUTOCOURT_LIVE=1 npx vitest run tests/live/diagnostic-record.test.ts
 *
 * Three records that differ in one document. On each, the seller lists a
 * 2003 Honda Accord at 87,432 miles with a signed invoice, and a buyer's
 * wallet uploads a pre-purchase scanner report with the same stored code,
 * P0128 (coolant temperature below the thermostat's regulating
 * temperature), typed in as a trouble code:
 *
 *   SYMPTOMS      the report records what the fault does: a gauge that stays
 *                 low on a long road test, lukewarm heat, a warning light
 *   NORMAL        the same code, and a road test on which everything read
 *                 normally
 *   CODE ONLY     the code and its definition, and nothing else
 *
 * Why the second and third exist: on the previous deployment the NORMAL
 * report raised the flag too, with every voting validator agreeing
 * (ac-000009 on 0x081Fe3bE…35A7). autocourt-rules-5 tells the panel that
 * only an observed effect of the fault is support, and refuses in code any
 * support quote that names the code.
 *
 * The contract normalizes the typed code itself; the flag, and the headline
 * it takes when no claim is adverse, are derived in code.
 */
import { describe, expect, it } from "vitest";

import { getItem, getRecord, getRun } from "../../lib/read";
import { LIVE, Receipts, adjudicate, fundedWallet, logger, openRecord, seal, upload, type Wallet } from "./helpers";

const VIN = "1HGCM82633A004352";
const log = logger("diagnostic");

const INVOICE =
  "SERVICE INVOICE 2026-03-07. Vehicle VIN 1HGCM82633A004352. Odometer " +
  "reading 87,432 miles at service. Replaced front brake pads and rotors. " +
  "Next service due at 92,000 miles.";

const HEADER = "PRE-PURCHASE OBD-II SCANNER REPORT 2026-06-02. Vehicle VIN 1HGCM82633A004352.\n";
const CODE_LINE = "Stored trouble code P0128: coolant temperature below thermostat regulating temperature.\n";

const SYMPTOMS =
  HEADER +
  CODE_LINE +
  "Road test, 25 minutes: the temperature gauge never rose above the lower quarter, " +
  "and the heater blew only lukewarm air. The engine management light is illuminated.";

const NORMAL =
  HEADER +
  CODE_LINE +
  "Road test, 25 minutes: the temperature gauge rose to normal and stayed there, " +
  "the heater blew hot, and no warning light came on.";

const CODE_ONLY = HEADER + CODE_LINE;

/** One record: the seller's invoice, the buyer's scan, sealed and judged. */
async function record(seller: Wallet, buyer: Wallet, scan: string, receipts: Receipts, tag: string) {
  const id = await openRecord(seller, { vin: VIN, make: "Honda", model: "Accord", year: 2003 }, [{ type: "MILEAGE", declared_value: "87,432 miles" }], receipts, `${tag}-create`);
  log(`${tag}: record ${id}`);
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
    `${tag}-invoice`,
  );
  const scanId = await upload(
    buyer,
    id,
    { declared_class: "DIAGNOSTIC_SCANNER_REPORT", label: "Pre-purchase scan", text: scan, diagnostic_codes: ["p0128"], capture_date: "2026-06-02" },
    receipts,
    `${tag}-scan`,
  );
  // The contract keeps the code in its normalized shape, in the uploader's name.
  const stored = (await getItem(id, scanId, true))!;
  expect(stored.diagnostic_codes).toEqual(["P0128"]);
  expect(stored.uploader_account).toBe(buyer.address);

  await seal(seller, id, receipts, `${tag}-seal`);
  await adjudicate(buyer, id, receipts, `${tag}-adjudicate`);
  const run = (await getRun(id, 1))!;
  const diagnostic = (run as unknown as { diagnostic?: Record<string, unknown> }).diagnostic ?? {};
  log(
    `${tag}: rollup ${run.report.rollup} · flags ${JSON.stringify(run.report.flags)} · inspection ${run.report.inspection_required} · ` +
      `diagnostic ${JSON.stringify(diagnostic)} · ruleset ${run.report.ruleset} · ${run.report.claims.map((c) => `${c.claim_id} ${c.verdict} ${c.confidence}`).join(", ")}`,
  );
  return { id, run };
}

describe.skipIf(!LIVE)("a stored trouble code, with and without an observed effect", () => {
  it("raises the diagnostic flag only when the evidence describes the fault's effect", { timeout: 75 * 60_000 }, async () => {
    const receipts = new Receipts(log);
    const seller = await fundedWallet("seller", log);
    const buyer = await fundedWallet("buyer", log);

    const symptoms = await record(seller, buyer, SYMPTOMS, receipts, "symptoms");
    const normal = await record(seller, buyer, NORMAL, receipts, "normal");
    const codeOnly = await record(seller, buyer, CODE_ONLY, receipts, "code-only");
    log(`records ${symptoms.id} (symptoms) · ${normal.id} (normal road test) · ${codeOnly.id} (code only) · receipts ${JSON.stringify(receipts.hashes)}`);

    expect(symptoms.run.report.ruleset).toBe("autocourt-rules-5");
    expect(symptoms.run.report.flags.diagnostic_concern_supported).toBe(true);
    expect(symptoms.run.report.flags.mileage_conflict).toBe(false);
    expect(symptoms.run.report.claims.some((c) => c.adverse)).toBe(false);
    expect(symptoms.run.report.rollup).toBe("DIAGNOSTIC_CONCERN_SUPPORTED");

    for (const control of [normal, codeOnly]) {
      expect(control.run.report.flags.diagnostic_concern_supported).toBe(false);
      expect(control.run.report.rollup).not.toBe("DIAGNOSTIC_CONCERN_SUPPORTED");
    }
  });
});
