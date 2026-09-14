/**
 * A clean record, end to end, on the deployment of record: the whole path a
 * seller takes in the app, driven through the SAME modules the browser runs
 * (extraction, hashing, the independent-source fingerprint, the manifest
 * root, the attestation, the write lifecycle and the faucet), with fresh
 * wallets and nothing else.
 *
 *   AUTOCOURT_LIVE=1 npx vitest run tests/live
 *
 * Skipped without the flag: it spends test GEN and takes several minutes.
 *
 * What it asserts, and why each is worth a transaction:
 *
 *   IDENTITY     every validator decodes the VIN at the federal registry and
 *                records CONFIRMED for the listed vehicle
 *   SOURCE       the registry extract committed in this repository at
 *                76a39ee, fetched from its pinned URL. Its readings sit in
 *                columns separated by two spaces, which is exactly what made
 *                ac-000023's copy enter SOURCE_UNAVAILABLE when the fingerprint
 *                was taken over the raw bytes. Taken over the bytes the
 *                validators' browser renders, the same file must now enter
 *                EXTRACTED
 *   ATTESTATION  the seller's signature is read back from the chain and
 *                verifies against the on-chain hashes
 *   VERDICT      the mileage claim reaches VERIFIED / HIGH on INDEPENDENT
 *                support, and the headline is VERIFIED
 *
 * The registry extract is fictional (fixtures/registry/README.md); the
 * lookup, the fetch, the hashes and the panel are real.
 */
import { createAccount, createClient } from "genlayer-js";
import { verifyMessage } from "viem";
import { describe, expect, it } from "vitest";

import { attestationMessage } from "../../lib/attest";
import { STUDIO_NEXT } from "../../lib/chain";
import { CONTRACT_ADDRESS } from "../../lib/config";
import { anchorStoredText, renderedText } from "../../lib/evidence/anchor";
import { extractEvidence } from "../../lib/evidence/extract";
import { sha256Bytes, sha256Text } from "../../lib/evidence/hash";
import { EXTRACTOR_VERSION } from "../../lib/evidence/normalize";
import { getBalanceAtto, requestTestGen } from "../../lib/faucet";
import { anchorItemJson, manifestRoot, nextEvidenceId, uploadedItemJson } from "../../lib/packet";
import { getRecord, getRecordIds, getStats, getVerdict } from "../../lib/read";
import { writeAndConfirm, type TxProgress } from "../../lib/tx";

const LIVE = Boolean(process.env.AUTOCOURT_LIVE);
const SOURCE =
  "https://raw.githubusercontent.com/Hemmy1417/AutoCourt/76a39eea547c8286dcdaf360899303f9c75b481b/fixtures/registry/1HGCM82633A004352.txt";
const VIN = "1HGCM82633A004352";
const log = (s: string) => console.log(`[clean ${new Date().toISOString().slice(11, 19)}] ${s}`);

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
    const receipts: Record<string, string> = {};
    const track = (step: string) => (p: TxProgress) => {
      if (p.hash) receipts[step] = p.hash;
      if (["accepted", "confirmed", "failed", "rejected", "unresolved"].includes(p.stage)) log(`${step}: ${p.stage} · ${p.detail}`);
    };

    const account = createAccount();
    const seller = account.address.toLowerCase();
    const client = createClient({ chain: STUDIO_NEXT, account });
    log(`seller ${account.address}`);

    // Test GEN, from the same faucet the wallet menu offers.
    await requestTestGen(account.address);
    for (let i = 0; i < 20 && (await getBalanceAtto(account.address)) === 0n; i++) await new Promise((r) => setTimeout(r, 2_000));
    expect(await getBalanceAtto(account.address)).toBeGreaterThan(0n);

    // 1. Open the record: every validator decodes the VIN.
    const before = (await getStats(true)).assessments;
    let id = "";
    await writeAndConfirm({
      client,
      address: CONTRACT_ADDRESS,
      functionName: "create_assessment",
      args: [
        JSON.stringify({ vin: VIN, make: "Honda", model: "Accord", year: 2003, seller_account: seller }),
        JSON.stringify([{ type: "MILEAGE", declared_value: "87,432 miles" }]),
      ],
      simulate: false,
      predicateTries: 40,
      predicate: async () => {
        const now = (await getStats(true)).assessments;
        if (now <= before) return false;
        for (const candidate of await getRecordIds(before, now - before, true)) {
          const r = await getRecord(candidate, true);
          if (r?.seller_account === seller) id = candidate;
        }
        return Boolean(id);
      },
      onProgress: track("create"),
    });
    log(`record ${id}`);
    let record = (await getRecord(id, true))!;
    expect(record.identity_status).toBe("CONFIRMED");

    // 2. The seller's invoice: extracted, fingerprinted and signed as the upload card does.
    const bytes = new TextEncoder().encode(INVOICE);
    const extraction = await extractEvidence(bytes);
    const text = extraction.normalizedText;
    const invoiceId = nextEvidenceId(record.items);
    const fileSha256 = await sha256Bytes(bytes);
    const textSha256 = await sha256Text(text);
    const signature = await account.signMessage!({ message: attestationMessage({ evidenceId: invoiceId, textSha256, fileSha256 }) });
    await writeAndConfirm({
      client,
      address: CONTRACT_ADDRESS,
      functionName: "submit_evidence_text",
      args: [
        id,
        uploadedItemJson({
          evidence_id: invoiceId,
          declared_class: "SERVICE_INVOICE",
          declared_label: "Service invoice",
          uploader_account: seller,
          uploader_role: "SELLER",
          file_sha256: fileSha256,
          text_sha256: textSha256,
          extractor_version: EXTRACTOR_VERSION,
          status: "EXTRACTED",
          text,
          uploader_signature: signature,
          observations: [{ doc_date: "2026-03-07", odometer_reading: 87432, odometer_unit: "MILES", source_field: "Odometer at service" }],
          diagnostic_codes: [],
          capture_date: "2026-03-07",
        }),
      ],
      predicate: async () => Boolean((await getRecord(id, true))?.items.some((i) => i.evidence_id === invoiceId)),
      onProgress: track("invoice"),
    });

    // 3. The independent source, fingerprinted as the validators will render it.
    const served = await (await fetch(SOURCE)).text();
    const rendered = renderedText(served);
    const expected = await sha256Text(rendered);
    log(`source fingerprint ${expected} (raw bytes would have been ${await sha256Text(served)})`);
    expect(expected).toBe("4308ed17c2a6685ec1f1d9bc4c53c297882c8fe3c74d2b24f3566004f3682eb6");
    record = (await getRecord(id, true))!;
    const sourceId = nextEvidenceId(record.items);
    await writeAndConfirm({
      client,
      address: CONTRACT_ADDRESS,
      functionName: "submit_anchor_item",
      args: [id, anchorItemJson({ evidence_id: sourceId, declared_label: "Registry extract", url: SOURCE, expected_sha256: expected })],
      simulate: false,
      predicateTries: 40,
      predicate: async () => Boolean((await getRecord(id, true))?.items.some((i) => i.evidence_id === sourceId)),
      onProgress: track("source"),
    });
    record = (await getRecord(id, true))!;
    const source = record.items.find((i) => i.evidence_id === sourceId)!;
    expect(source.status).toBe("EXTRACTED");
    // No party authored the source; the wallet that asked for it is recorded apart.
    expect(source.uploader_account).toBe("");
    expect(source.added_by).toBe(seller);
    expect(source.file_sha256).toBe(expected);
    expect(source.text_sha256).toBe(await sha256Text(anchorStoredText(rendered)));

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
    const root = await manifestRoot(
      record.items.map((i) => ({ evidenceId: i.evidence_id, fileSha256: i.file_sha256, textSha256: i.text_sha256, extractorVersion: i.extractor_version })),
    );
    await writeAndConfirm({
      client,
      address: CONTRACT_ADDRESS,
      functionName: "submit_assessment",
      args: [id, root],
      predicate: async () => (await getRecord(id, true))?.state === "SEALED",
      onProgress: track("seal"),
    });

    // 6. The panel.
    await writeAndConfirm({
      client,
      address: CONTRACT_ADDRESS,
      functionName: "adjudicate",
      args: [id],
      simulate: false,
      predicateTries: 100,
      predicate: async () => ((await getRecord(id, true))?.runs_count ?? 0) > 0,
      onProgress: track("adjudicate"),
    });
    const verdict = (await getVerdict(id, true))!;
    const claim = verdict.claims![0]!;
    log(`${claim.claim_type} → ${claim.verdict} · ${claim.confidence} · support ${claim.support_classes.join(", ")} · rollup ${verdict.rollup}`);
    log(`receipts ${JSON.stringify(receipts)}`);

    expect(claim.verdict).toBe("VERIFIED");
    expect(claim.confidence).toBe("HIGH");
    expect(claim.support_classes).toContain("INDEPENDENT");
    expect(claim.contradict_classes).toHaveLength(0);
    expect(verdict.rollup).toBe("VERIFIED");
    expect(Object.values(verdict.flags ?? {}).some(Boolean)).toBe(false);
  });
});
