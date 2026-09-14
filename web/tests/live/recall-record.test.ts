/**
 * A seller's claim against a real public authority: NHTSA's recall list,
 * fetched by every validator from the US Department of Transportation,
 * on the deployment of record.
 *
 *   AUTOCOURT_LIVE=1 npx vitest run tests/live/recall-record.test.ts
 *
 * The story, as two wallets act it in the app:
 *
 *   1. The seller lists a 2003 Honda Accord and declares that no safety
 *      recall has ever been issued for it.
 *   2. A buyer disputes that claim IN THEIR OWN NAME and asks the
 *      validators to fetch NHTSA's recall list for the vehicle. Nothing
 *      about that list was written by either party.
 *   3. The seller seals; the buyer, a recorded party, asks for the panel.
 *      The claim is CLAIM_CONTRADICTED on INDEPENDENT evidence.
 *   4. The seller appeals with their own signed declaration. The appeal
 *      re-reads the NHTSA bytes the record already holds, never a fresh
 *      fetch, and the seller's own paperwork cannot turn a source no party
 *      wrote into a conflict: the claim stays contradicted.
 *
 * What each step asserts is in the code below; nothing else is claimed.
 */
import { describe, expect, it } from "vitest";

import { anchorStoredText, nhtsaRecallsUrl } from "../../lib/evidence/anchor";
import { sha256Text } from "../../lib/evidence/hash";
import { getItem, getManifest, getRecord, getRun, getVerdict } from "../../lib/read";
import {
  LIVE,
  Receipts,
  addSource,
  adjudicate,
  appeal,
  dispute,
  fundedWallet,
  logger,
  openRecord,
  seal,
  upload,
} from "./helpers";

const VIN = "1HGCM82633A004352";
const VEHICLE = { vin: VIN, make: "Honda", model: "Accord", year: 2003 };
const CLAIM = "No safety recall has ever been issued for the 2003 Honda Accord";
const log = logger("recall");

const DECLARATION =
  "SELLER'S DECLARATION\n" +
  `Vehicle: 2003 Honda Accord, VIN ${VIN}\n\n` +
  "I, the seller of this vehicle, declare that no safety recall has ever been issued for the 2003 Honda Accord, " +
  "and that no recall applies to this car.\n\n" +
  "Signed by the seller, 14 September 2026.\n";

describe.skipIf(!LIVE)("a claim tested against NHTSA's recall list", () => {
  it("contradicts the claim on the independent source, and holds on the seller's appeal", { timeout: 75 * 60_000 }, async () => {
    const receipts = new Receipts(log);
    const seller = await fundedWallet("seller", log);
    const buyer = await fundedWallet("buyer", log);

    // 1. The listing and its claim.
    const id = await openRecord(seller, VEHICLE, [{ type: "DEFECT_DISCLOSURE", declared_value: CLAIM }], receipts);
    log(`record ${id}`);
    let record = (await getRecord(id, true))!;
    expect(record.identity_status).toBe("CONFIRMED");
    expect(record.seller_account).toBe(seller.address);
    const claimId = record.claims[0]!.claim_id;

    // 2. The buyer's dispute and the buyer's source, each in the buyer's name.
    await dispute(buyer, id, [claimId], "NHTSA lists safety recalls for this model year.", receipts, "dispute");
    const url = nhtsaRecallsUrl(record);
    const source = await addSource(buyer, id, url, "NHTSA recalls for the 2003 Honda Accord", receipts, "source");
    log(`source ${source.evidenceId}: ${url} · served ${source.servedChars} chars · fingerprint ${source.expected}`);
    record = (await getRecord(id, true))!;
    expect(record.disputes.map((d) => d.account)).toEqual([buyer.address]);
    const entered = record.items.find((i) => i.evidence_id === source.evidenceId)!;
    expect(entered.lane).toBe("ANCHOR");
    expect(entered.status).toBe("EXTRACTED");
    expect(entered.added_by).toBe(buyer.address);
    expect(entered.uploader_account).toBe("");
    expect(entered.file_sha256).toBe(source.expected);
    expect(entered.text_sha256).toBe(await sha256Text(anchorStoredText(source.rendered)));
    const stored = (await getItem(id, source.evidenceId, true))!;
    expect(stored.url).toBe(url);
    expect(stored.text).toContain("NHTSACampaignNumber");

    // 3. Only the seller seals; the buyer is a party, so the buyer may ask for the panel.
    const root = await seal(seller, id, receipts);
    await adjudicate(buyer, id, receipts, "adjudicate");
    const run1 = (await getRun(id, 1))!;
    const first = run1.report.claims.find((c) => c.claim_id === claimId)!;
    log(`run 1: ${first.verdict} · ${first.confidence} · support [${first.support_classes}] · contradict [${first.contradict_classes}] · rollup ${run1.report.rollup}`);
    expect(run1.kind).toBe("ADJUDICATION");
    expect(first.verdict).toBe("CLAIM_CONTRADICTED");
    expect(first.contradict_classes).toContain("INDEPENDENT");
    expect(first.confidence).toBe("HIGH");
    expect(first.next_action).toBe("RAISE_WITH_SELLER");
    expect(run1.report.rollup).toBe("MATERIAL_CONCERN");
    expect(run1.report.ruleset).toBe("autocourt-rules-4");

    // 4. The seller's appeal: their own signed declaration, then the appeal in their own name.
    const declared = await upload(
      seller,
      id,
      { declared_class: "SELLER_DECLARATION", label: "Seller's declaration on recalls", text: DECLARATION, capture_date: "2026-09-14" },
      receipts,
      "appeal-evidence",
      true,
    );
    await appeal(
      seller,
      id,
      "The seller's signed declaration states that no recall applies to this car. The claim should stand.",
      receipts,
      "appeal",
    );
    record = (await getRecord(id, true))!;
    const run2 = (await getRun(id, 2))!;
    const second = run2.report.claims.find((c) => c.claim_id === claimId)!;
    log(`run 2: ${second.verdict} · ${second.confidence} · support [${second.support_classes}] · contradict [${second.contradict_classes}] · rollup ${run2.report.rollup}`);
    expect(run2.kind).toBe("RE_ADJUDICATION");
    expect(run2.appellant).toBe(seller.address);
    expect(run2.prior_run).toBe(1);
    expect(record.items.find((i) => i.evidence_id === declared)).toMatchObject({ phase: "APPEAL", judged_version: 2, uploader_account: seller.address });

    // The appeal judged the SAME source bytes: the manifest entry is unchanged.
    const v1 = (await getManifest(id, 1))!;
    const v2 = (await getManifest(id, 2))!;
    expect(v1.root).toBe(root);
    const entryOf = (m: typeof v1) => m.entries.find((e) => e[0] === source.evidenceId);
    expect(entryOf(v1)).toBeDefined();
    expect(entryOf(v2)).toEqual(entryOf(v1));

    expect(second.verdict).toBe("CLAIM_CONTRADICTED");
    expect(second.contradict_classes).toContain("INDEPENDENT");
    if (second.support_classes.includes("FIRST_PARTY")) {
      // The panel read the declaration as support. Under autocourt-rules-3 the same
      // findings would have derived CONFLICTING_EVIDENCE.
      log("the panel read the seller's declaration as support, and the claim still stands contradicted");
    } else {
      log("the panel did not read the seller's declaration as support of the claim");
    }
    const verdict = (await getVerdict(id, true))!;
    expect(verdict.standing_run).toBe(2);
    log(`receipts ${JSON.stringify(receipts.hashes)}`);
  });
});
