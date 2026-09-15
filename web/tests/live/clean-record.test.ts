/**
 * A clean record, end to end, on the deployment of record: the whole path a
 * seller takes in the app, driven through the SAME modules the browser runs
 * (extraction, hashing, the independent-source fingerprint, the manifest
 * root, the attestation, the write lifecycle and the faucet), with a fresh
 * wallet and nothing else.
 *
 *   AUTOCOURT_LIVE=1 npx vitest run tests/live/clean-record.test.ts
 *
 * Skipped without the flag: it spends test GEN and takes several minutes.
 *
 * What it asserts, and why each is worth a transaction:
 *
 *   IDENTITY     every validator decodes the VIN at the federal registry and
 *                records CONFIRMED for the listed vehicle
 *   SOURCE       the registry extract committed in this repository at
 *                76a39ee, fetched from its pinned URL. Its readings sit in
 *                columns separated by two spaces, so a fingerprint taken over
 *                the raw bytes could never match what a validator hashes.
 *                Taken over the text the validators' browser renders, the
 *                file must enter EXTRACTED
 *   ATTESTATION  the seller's signature is read back from the chain and
 *                verifies against the on-chain hashes
 *   SEAL         the manifest root the app computed is the one the contract
 *                sealed
 *   VERDICT      the mileage claim reaches VERIFIED / HIGH on INDEPENDENT
 *                support, and the headline is VERIFIED
 *
 * The registry extract is fictional (fixtures/registry/README.md); the
 * lookup, the fetch, the hashes and the panel are real.
 */
import { verifyMessage } from "viem";
import { describe, expect, it } from "vitest";

import { attestationMessage } from "../../lib/attest";
import { anchorStoredText } from "../../lib/evidence/anchor";
import { sha256Text } from "../../lib/evidence/hash";
import { getManifest, getRecord, getVerdict } from "../../lib/read";
import { LIVE, Receipts, addSource, adjudicate, fundedWallet, logger, openRecord, seal, upload } from "./helpers";

const SOURCE =
  "https://raw.githubusercontent.com/Hemmy1417/AutoCourt/76a39eea547c8286dcdaf360899303f9c75b481b/fixtures/registry/1HGCM82633A004352.txt";
const VIN = "1HGCM82633A004352";
const log = logger("clean");

const INVOICE =
  "SERVICE INVOICE No. 30871\n" +
  "Harbour Road Motors, Eastfield\n" +
  "Date: 2026-03-07\n\n" +
  `Vehicle: 2003 Honda Accord, VIN ${VIN}, registration EF03 HNA\n` +
  "Odometer at service: 87,432 miles\n\n" +
  "Work carried out:\n" +
  "- Annual roadworthiness inspection: passed\n" +
  "- Engine oil and filter changed\n" +
  "- Front wiper blades replaced\n\n" +
  "Total: 214.60\n";

describe.skipIf(!LIVE)("a clean record on the deployment of record", () => {
  it("confirms the vehicle, enters this repository's source, and verifies the claim", { timeout: 45 * 60_000 }, async () => {
    const receipts = new Receipts(log);
    const seller = await fundedWallet("seller", log);

    // 1. Open the record: every validator decodes the VIN.
    const id = await openRecord(seller, { vin: VIN, make: "Honda", model: "Accord", year: 2003 }, [{ type: "MILEAGE", declared_value: "87,432 miles" }], receipts);
    log(`record ${id}`);
    expect((await getRecord(id, true))!.identity_status).toBe("CONFIRMED");

    // 2. The seller's invoice: extracted, fingerprinted and signed as the upload card does.
    const invoiceId = await upload(
      seller,
      id,
      {
        declared_class: "SERVICE_INVOICE",
        label: "Service invoice",
        text: INVOICE,
        observations: [{ doc_date: "2026-03-07", odometer_reading: 87432, odometer_unit: "MILES", source_field: "Odometer at service" }],
        capture_date: "2026-03-07",
      },
      receipts,
      "invoice",
    );

    // 3. The independent source, fingerprinted as the validators will render it.
    const source = await addSource(seller, id, SOURCE, "Registry extract", receipts, "source");
    log(`source fingerprint ${source.expected}`);
    expect(source.expected).toBe("4308ed17c2a6685ec1f1d9bc4c53c297882c8fe3c74d2b24f3566004f3682eb6");
    const record = (await getRecord(id, true))!;
    const entered = record.items.find((i) => i.evidence_id === source.evidenceId)!;
    expect(entered.status).toBe("EXTRACTED");
    // No party authored the source; the wallet that asked for it is recorded apart.
    expect(entered.uploader_account).toBe("");
    expect(entered.added_by).toBe(seller.address);
    expect(entered.file_sha256).toBe(source.expected);
    expect(entered.text_sha256).toBe(await sha256Text(anchorStoredText(source.rendered)));

    // 4. The attestation, from the chain alone.
    const invoice = record.items.find((i) => i.evidence_id === invoiceId)!;
    expect(
      await verifyMessage({
        address: invoice.uploader_account as `0x${string}`,
        message: attestationMessage({ evidenceId: invoice.evidence_id, textSha256: invoice.text_sha256, fileSha256: invoice.file_sha256 }),
        signature: invoice.uploader_signature as `0x${string}`,
      }),
    ).toBe(true);

    // 5. Seal under the root the contract recomputes.
    const root = await seal(seller, id, receipts);
    expect((await getManifest(id, 1))!.root).toBe(root);

    // 6. The panel.
    await adjudicate(seller, id, receipts);
    const verdict = (await getVerdict(id, true))!;
    const claim = verdict.claims![0]!;
    log(`${claim.claim_type} → ${claim.verdict} · ${claim.confidence} · support ${claim.support_classes.join(", ")} · rollup ${verdict.rollup}`);
    log(`receipts ${JSON.stringify(receipts.hashes)}`);

    expect(claim.verdict).toBe("VERIFIED");
    expect(claim.confidence).toBe("HIGH");
    expect(claim.support_classes).toContain("INDEPENDENT");
    expect(claim.contradict_classes).toHaveLength(0);
    expect(verdict.rollup).toBe("VERIFIED");
    expect(Object.values(verdict.flags ?? {}).some(Boolean)).toBe(false);
  });
});
