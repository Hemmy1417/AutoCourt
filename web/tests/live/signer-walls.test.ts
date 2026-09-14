/**
 * Every write belongs to the wallet that signs it, on the deployment of
 * record, proven where it matters: by transactions the app would never send.
 *
 *   AUTOCOURT_LIVE=1 npx vitest run tests/live/signer-walls.test.ts
 *
 * A stranger's wallet sends each forbidden write straight to the chain,
 * priced with the plain fee estimate and NEVER simulated, so nothing but the
 * contract stands in the way. Each one must FINALIZE with the leader's
 * execution in ERROR and the contract's own sentence:
 *
 *   open a record naming someone else as the seller
 *   dispute a claim in another wallet's name
 *   upload a document attributed to the seller
 *   add a source whose URL smuggles another host past the allowlist
 *   seal the seller's packet
 *   ask for the panel without being a party to the record
 *
 * The app's own path is checked beside them: the same forbidden seal,
 * simulated first as the app does, is stopped before anything is signed.
 * Then the positive controls: the stranger disputes IN THEIR OWN NAME, which
 * makes them a recorded party, and the panel request refused a moment
 * earlier goes through.
 *
 * The record itself is the other live identity outcome: the VIN is a real
 * motor coach's, which the federal registry decodes as a 1989 Motor Coach
 * Industries bus, listed here as a 2019 Meridian GT Wagon. Every
 * validator's registry read says MISMATCH, and it takes the headline.
 */
import { describe, expect, it } from "vitest";

import { CONTRACT_ADDRESS } from "../../lib/config";
import { anchorItemJson, manifestRoot, uploadedItemJson } from "../../lib/packet";
import { getRecord, getRun, getStats } from "../../lib/read";
import {
  LIVE,
  Receipts,
  adjudicate,
  dispute,
  fundedWallet,
  logger,
  openRecord,
  refusedBeforeSending,
  refusedOnChain,
  seal,
  upload,
} from "./helpers";

const VIN = "1M8GDM9AXKP042788";
const LISTED = { vin: VIN, make: "Meridian", model: "GT Wagon", year: 2019 };
const log = logger("walls");
const SOMEONE_ELSE = "0x5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a";

const INVOICE =
  "SERVICE INVOICE No. 5120\n" +
  "Northgate Coachworks\n" +
  "Date: 2026-06-02\n\n" +
  `Vehicle: 2019 Meridian GT Wagon, VIN ${VIN}\n` +
  "Odometer at service: 41,200 miles\n\n" +
  "Work carried out: annual inspection, passed.\n";

describe.skipIf(!LIVE)("every write is the signer's", () => {
  it("refuses each forbidden write on chain, in the contract's words", { timeout: 60 * 60_000 }, async () => {
    const receipts = new Receipts(log);
    const seller = await fundedWallet("seller", log);
    const stranger = await fundedWallet("stranger", log);
    const walls: Record<string, string> = {};

    const id = await openRecord(seller, LISTED, [{ type: "MILEAGE", declared_value: "41,200 miles" }], receipts);
    log(`record ${id}`);
    let record = (await getRecord(id, true))!;
    expect(record.identity_status).toBe("MISMATCH");
    expect(record.registry_fields.ModelYear).toBe("1989");
    expect(record.registry_fields.Make).toMatch(/motor coach/i);
    log(`registry: ${JSON.stringify(record.registry_fields)}`);

    // 1. A record opened in someone else's name.
    const before = (await getStats(true)).assessments;
    const named = await refusedOnChain(
      stranger,
      "create_assessment",
      [JSON.stringify({ ...LISTED, seller_account: seller.address }), JSON.stringify([{ type: "MILEAGE", declared_value: "1 mile" }])],
      log,
    );
    expect(named.executed).toBe("ERROR");
    expect(named.sentence).toBe("[EXPECTED] seller_account must be the wallet that signs this transaction");
    expect((await getStats(true)).assessments).toBe(before);
    walls.create = named.hash;

    // 2. A dispute in another wallet's name.
    const disputed = await refusedOnChain(stranger, "record_dispute", [id, SOMEONE_ELSE, JSON.stringify(["CL-01"]), "not mine to make"], log);
    expect(disputed.sentence).toBe("[EXPECTED] the disputing account must be the wallet that signs this transaction");
    walls.dispute = disputed.hash;

    // 3. A document attributed to the seller.
    const forged = await refusedOnChain(
      stranger,
      "submit_evidence_text",
      [
        id,
        uploadedItemJson({
          evidence_id: "E-001",
          declared_class: "SERVICE_INVOICE",
          declared_label: "Forged in the seller's name",
          uploader_account: seller.address,
          uploader_role: "SELLER",
          file_sha256: "a".repeat(64),
          text_sha256: "b".repeat(64),
          extractor_version: "extractor-1.0.0",
          status: "UNEXTRACTED",
          text: "",
          uploader_signature: "",
          observations: [],
          diagnostic_codes: [],
          capture_date: "",
        }),
      ],
      log,
    );
    expect(forged.sentence).toBe("[EXPECTED] uploader_account must be the wallet that signs this transaction");
    walls.upload = forged.hash;

    // 4. A source whose URL names an allowlisted host but would be fetched from another.
    const smuggled = await refusedOnChain(
      stranger,
      "submit_anchor_item",
      [id, anchorItemJson({ evidence_id: "E-001", declared_label: "Smuggled", url: "https://raw.githubusercontent.com:x@evil.example/extract.txt", expected_sha256: "c".repeat(64) })],
      log,
    );
    expect(smuggled.sentence).toBe("[EXPECTED] anchor url must name a plain host");
    walls.source = smuggled.hash;
    expect((await getRecord(id, true))!.items).toHaveLength(0);

    // 5. The seller's seal: first the app's own path, which sends nothing ...
    await upload(
      seller,
      id,
      {
        declared_class: "SERVICE_INVOICE",
        label: "June inspection",
        text: INVOICE,
        observations: [{ doc_date: "2026-06-02", odometer_reading: 41200, odometer_unit: "MILES", source_field: "Odometer at service" }],
        capture_date: "2026-06-02",
      },
      receipts,
      "invoice",
    );
    record = (await getRecord(id, true))!;
    const root = await manifestRoot(
      record.items.map((i) => ({ evidenceId: i.evidence_id, fileSha256: i.file_sha256, textSha256: i.text_sha256, extractorVersion: i.extractor_version })),
    );
    const inApp = await refusedBeforeSending(stranger, "submit_assessment", [id, root]);
    expect(inApp.sent).toBe(false);
    expect(inApp.last.stage).toBe("failed");
    expect(inApp.last.at).toBe("estimating");
    expect(inApp.last.detail).toBe("The contract refused this, so nothing was sent: only the seller of record can seal the packet.");

    // ... then the same write forced onto the chain.
    const sealed = await refusedOnChain(stranger, "submit_assessment", [id, root], log);
    expect(sealed.sentence).toBe("[EXPECTED] only the seller of record can seal the packet");
    walls.seal = sealed.hash;
    expect((await getRecord(id, true))!.state).toBe("OPEN");

    // 6. The panel, asked for by a wallet that is no party to the record.
    await seal(seller, id, receipts);
    const judged = await refusedOnChain(stranger, "adjudicate", [id], log);
    expect(judged.sentence).toBe("[EXPECTED] only a recorded party may request adjudication");
    walls.adjudicate = judged.hash;
    expect((await getRecord(id, true))!.runs_count).toBe(0);

    // The positive control: a dispute in the stranger's OWN name makes them a party,
    // and the request refused above goes through.
    await dispute(stranger, id, ["CL-01"], "The VIN does not decode to this vehicle.", receipts, "dispute");
    record = (await getRecord(id, true))!;
    expect(record.disputes).toHaveLength(1);
    // The account is recorded lowercase; `address` is the sender exactly as the chain reports it.
    expect(record.disputes[0]!.account).toBe(stranger.address);
    expect(record.disputes[0]!.address.toLowerCase()).toBe(stranger.address);
    await adjudicate(stranger, id, receipts, "adjudicate");
    const run = (await getRun(id, 1))!;
    log(`run 1: rollup ${run.report.rollup} · flags ${JSON.stringify(run.report.flags)} · ${run.report.claims.map((c) => `${c.claim_id} ${c.verdict} ${c.confidence}`).join(", ")}`);
    expect(run.report.flags.vehicle_identity_mismatch).toBe(true);
    expect(run.report.rollup).toBe("MATERIAL_CONCERN");
    expect(run.report.claims.every((c) => c.verdict !== "VERIFIED")).toBe(true);

    log(`refused on chain ${JSON.stringify(walls)}`);
    log(`receipts ${JSON.stringify(receipts.hashes)} · contract ${CONTRACT_ADDRESS}`);
  });
});
