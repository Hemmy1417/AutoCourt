/**
 * A clean record, end to end, with every source of it in this repository.
 *
 *   node scripts/prove-clean-record.mjs [commit]
 *
 *   (server + dev-db + worker up; `npx tsc -b` first. The commit defaults to
 *   the last one that touched the fixture, and must already be pushed.)
 *
 * Every earlier VERIFIED on the deployment of record rested on a VIN the
 * federal registry could not decode — absence of confirmation never caps —
 * and on an independent source borrowed from a sibling project's fixtures,
 * because this repository was not public yet. This is the record a buyer
 * hopes to find, with nothing borrowed:
 *
 *   IDENTITY     the VIN decodes at NHTSA vPIC to the listed vehicle, and
 *                every validator records CONFIRMED; no party supplies it
 *   SOURCE       a registry extract committed HERE, fetched by every
 *                validator from its commit-pinned URL. Before anything is
 *                written, the URL is shown to serve exactly the committed
 *                blob; afterwards the contract's own record is shown to
 *                hold that blob's hash and the hash of its normalized text
 *   ATTESTATION  the seller's wallet signs the hashes of their upload at
 *                consent. The signature is read back FROM THE CHAIN and
 *                checked against the on-chain hashes, as anyone can
 *   VERDICT      the mileage claim reaches VERIFIED / HIGH resting on
 *                INDEPENDENT support, and the headline is VERIFIED
 *
 * The registry extract is fictional (fixtures/registry/README.md says so,
 * and why); the identity lookup, the fetch, the hashes and the panel are real.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { verifyMessage } from "viem";

// The COMPILED client, the same one the app and the worker use.
import { AutoCourtChain } from "../packages/genlayer-client/dist/index.js";
import { Actor, BASE, asserter, logger, settled } from "./lib/harness.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RPC = process.env.GENLAYER_RPC_URL ?? "https://studio-next.genlayer.com/api";
const FIXTURE = "fixtures/registry/1HGCM82633A004352.txt";
const VIN = "1HGCM82633A004352";
const ANCHOR_FETCH_CAP = 8_000; // the contract's: the bytes every validator hashes
const PER_ITEM_TEXT_CAP = 6_000; // the contract's: normalized text it stores

const log = logger("clean");
const { hard, failures } = asserter(log);
const wait = (actor, id, label) => settled(actor, id, label, { log });
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: ROOT }).toString();

/**
 * The attestation text, as apps/web/lib/attest.ts builds it. A copy, because
 * plain Node cannot import TypeScript — but not a trusted one: the server
 * verifies every signature against its own builder, so a copy that drifted
 * would be refused with a 400 and stop this run, never pass it.
 */
const attestationMessage = ({ evidenceId, textSha256, fileSha256 }) =>
  "AutoCourt evidence attestation (autocourt-attestation-1)\n\n" +
  `evidence: ${evidenceId}\n` +
  `document sha256: ${fileSha256}\n` +
  `judged text sha256: ${textSha256}\n\n` +
  "Signing records that these are the bytes I uploaded. The signature " +
  "goes on a public record beside the hash it covers, so anyone can " +
  "check later that this evidence was not substituted.";

// ── 0. the source: this repository, at a pinned commit ──────────────────────
const commit = (process.argv[2] ?? git("log", "-1", "--format=%H", "--", FIXTURE)).trim();
const origin = git("remote", "get-url", "origin").trim();
const [, owner, repo] = origin.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/) ?? [];
if (!/^[0-9a-f]{40}$/.test(commit) || !owner) {
  console.error(`need a full commit hash and a GitHub origin (got "${commit}", "${origin}")`);
  process.exit(2);
}
const ANCHOR = `https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${FIXTURE}`;
const blob = git("cat-file", "-p", `${commit}:${FIXTURE}`);
log(`source ${ANCHOR}`);

hard(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(blob),
     "the fixture is plain ASCII, so a character cap and a byte cap agree");
hard(blob.length < PER_ITEM_TEXT_CAP,
     "the fixture fits every cap whole, so its hashes can be recomputed exactly");
const served = await fetch(ANCHOR).then(async (r) => (r.ok ? r.text() : null));
hard(served === blob, "the pinned URL serves exactly the committed blob");
if (served !== blob) {
  console.error("stopping: push the commit first — nothing has been written");
  process.exit(1);
}
const blobHash = sha(blob.slice(0, ANCHOR_FETCH_CAP));
// The contract's normalization: " ".join(body.split()).
const blobTextHash = sha(blob.split(/\s+/).filter(Boolean).join(" "));
log(`committed blob sha256 ${blobHash}`);

const { contractAddress: CONTRACT } = await (await fetch(`${BASE}/api/config`)).json();
const chain = new AutoCourtChain({ rpcUrl: RPC, contractAddress: CONTRACT });
log(`contract ${CONTRACT}`);

// ── 1. the seller lists the car and documents it ────────────────────────────
const seller = await new Actor("Clean Record Seller").signIn();
const sellerAddress = seller.account.address.toLowerCase();
const vehicle = await seller.api("/api/vehicles", {
  method: "POST",
  body: JSON.stringify({
    vin: VIN, make: "Honda", model: "Accord", year: 2003,
    claims: [{ type: "MILEAGE", declaredValue: "87,432 miles" }],
  }),
});
const a = await seller.api("/api/assessments", {
  method: "POST", body: JSON.stringify({ vehicleId: vehicle.id }),
});
log(`record ${a.id}`);

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
const form = new FormData();
form.set("file", new Blob([INVOICE], { type: "text/plain" }), "service-invoice-30871.txt");
form.set("declaredClass", "SERVICE_INVOICE");
form.set("declaredLabel", "Service invoice");
form.set("captureDate", "2026-03-07");
const invoice = await seller.api(`/api/assessments/${a.id}/evidence`, { method: "POST", body: form });
await seller.api(`/api/assessments/${a.id}/evidence/${invoice.id}/observations`, {
  method: "POST",
  body: JSON.stringify({
    rows: [{ docDate: "2026-03-07", odometerReading: 87432, odometerUnit: "MILES", sourceField: "Odometer at service" }],
  }),
});

// A signature over any other bytes is refused outright…
const forged = await seller.account.signMessage({
  message: attestationMessage({ ...invoice, textSha256: sha("different bytes") }),
});
const refusedConsent = await seller.raw(
  `/api/assessments/${a.id}/evidence/${invoice.id}/consent`,
  { method: "POST", body: JSON.stringify({ consentVersion: "publicity-statement-1", signature: forged }) },
);
const refusal = await refusedConsent.json().catch(() => null);
hard(refusedConsent.status === 400,
     `a signature over other bytes is refused (${refusedConsent.status}: "${refusal?.message ?? ""}")`);

// …and one over these bytes is what consent records.
const signature = await seller.account.signMessage({ message: attestationMessage(invoice) });
await seller.api(`/api/assessments/${a.id}/evidence/${invoice.id}/consent`, {
  method: "POST",
  body: JSON.stringify({ consentVersion: "publicity-statement-1", signature }),
});
log(`${invoice.evidenceId} uploaded, consented and signed`);

// ── 2. the independent source enters: every validator fetches it ────────────
const added = await seller.api(`/api/assessments/${a.id}/anchor`, {
  method: "POST",
  body: JSON.stringify({ url: ANCHOR, declaredLabel: "Registry extract" }),
});
hard(added.expected === blobHash, "the app committed the committed blob's hash, not a guess");
const entered = await wait(seller, a.id, "source entering");

hard(entered.identityStatus === "CONFIRMED",
     `the federal registry confirms the listed vehicle (${entered.identityStatus})`);
const onChainId = entered.onChainId;
const anchorRow = entered.evidenceItems.find((i) => i.lane === "ANCHOR");
const onChainAnchor = await chain.getItemText(onChainId, anchorRow.evidenceId);
hard(onChainAnchor.lane === "ANCHOR" && onChainAnchor.status === "EXTRACTED",
     `the contract entered the source as EXTRACTED (${onChainAnchor.status})`);
hard(onChainAnchor.file_sha256 === blobHash,
     "the contract's record holds the committed blob's hash — every validator fetched exactly those bytes");
hard(onChainAnchor.text_sha256 === blobTextHash,
     "the stored text hash is the committed blob, normalized — recomputable by anyone");

// ── 3. sealed and judged ─────────────────────────────────────────────────────
await seller.api(`/api/assessments/${a.id}/submit`, { method: "POST" });
await wait(seller, a.id, "sealing");

const onChainInvoice = await chain.getItemText(onChainId, invoice.evidenceId);
hard(onChainInvoice.uploader_account === sellerAddress,
     "the upload is attributed on chain to the seller's wallet");
hard(onChainInvoice.uploader_signature === signature,
     "the seller's attestation is on the public record beside the hashes it covers");
const attested = await verifyMessage({
  address: seller.account.address,
  message: attestationMessage({
    evidenceId: onChainInvoice.evidence_id,
    textSha256: onChainInvoice.text_sha256,
    fileSha256: onChainInvoice.file_sha256,
  }),
  signature: onChainInvoice.uploader_signature,
}).catch(() => false);
hard(attested, "read back from the chain alone, the signature verifies against the on-chain hashes");

await seller.api(`/api/assessments/${a.id}/adjudicate`, { method: "POST" });
log("adjudicating");
await wait(seller, a.id, "panel");

const verdict = await chain.getVerdict(onChainId);
const claim = verdict.claims?.[0];
log(`${claim?.claim_type} → ${claim?.verdict} · confidence ${claim?.confidence} · ` +
    `support ${JSON.stringify(claim?.support_classes)} · contradict ${JSON.stringify(claim?.contradict_classes)}`);
hard(claim?.verdict === "VERIFIED", "the mileage claim reaches VERIFIED");
hard(claim?.confidence === "HIGH", "with HIGH confidence, derived in code");
hard((claim?.support_classes ?? []).includes("INDEPENDENT"),
     "resting on INDEPENDENT support, not the seller's own word");
hard((claim?.contradict_classes ?? []).length === 0, "with nothing on the record against it");
hard(verdict.rollup === "VERIFIED", `the headline is VERIFIED (${verdict.rollup})`);
const raised = Object.entries(verdict.flags ?? {}).filter(([, on]) => on).map(([k]) => k);
hard(raised.length === 0, `no flag is raised (${raised.join(", ") || "none"})`);

// ── the receipts ─────────────────────────────────────────────────────────────
const { jobs } = await seller.api(`/api/assessments/${a.id}/jobs`);
console.log("\n============== A CLEAN RECORD ==============");
console.log(`contract   ${CONTRACT}`);
console.log(`record     ${onChainId} (app ${a.id})`);
console.log(`source     ${ANCHOR}`);
console.log(`blob hash  ${blobHash}`);
console.log(`identity   ${entered.identityStatus}`);
console.log(`verdict    ${verdict.rollup} · ${claim?.claim_id} ${claim?.verdict} / ${claim?.confidence} · run ${verdict.standing_run} of ${verdict.total_runs}`);
for (const j of jobs) console.log(`  ${j.kind.padEnd(16)} ${j.state.padEnd(7)} ${j.txHash ?? "—"}`);
console.log(failures.length === 0
  ? "PROOF COMPLETE — confirmed identity, this repository's own source, a signed upload, VERIFIED."
  : `PROOF INCOMPLETE — ${failures.length}: ${failures.join("; ")}`);
console.log("============================================");
process.exit(failures.length === 0 ? 0 : 1);
