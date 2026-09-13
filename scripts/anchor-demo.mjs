/**
 * The anchor lane, live: the only path to VERIFIED.
 *
 *   node scripts/anchor-demo.mjs 0x<contract> <raw-github-url-of-fixture>
 *
 * Creates an assessment, enters the seller's invoice (FIRST_PARTY) AND
 * the registry fixture through the anchor lane — every validator fetches
 * the commit-pinned URL itself, exact-hash agreement — then seals and
 * runs the panel. The floor proven in the arc (no VERIFIED without
 * INDEPENDENT) meets its counterpart here: with an INDEPENDENT anchor on
 * the record, VERIFIED is reachable.
 */
import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RPC = process.env.GENLAYER_RPC_URL ?? "https://studio-next.genlayer.com/api";
const chain = { ...studioDevnet, name: "GenLayer Studio Next", rpcUrls: { default: { http: [RPC] } } };
const CONTRACT = process.argv[2];
const ANCHOR_URL = process.argv[3];
if (!CONTRACT?.startsWith("0x") || !ANCHOR_URL?.startsWith("https://raw.githubusercontent.com/")) {
  console.error("usage: node scripts/anchor-demo.mjs 0x<contract> https://raw.githubusercontent.com/<owner>/<repo>/<commit>/fixtures/registry/1M8GDM9AXKP042788.txt");
  process.exit(2);
}
const KEYS = JSON.parse(readFileSync(
  fileURLToPath(new URL("../.data/keys.json", import.meta.url)), "utf-8"));
const FEE_FLOOR = 10n ** 15n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash("sha256").update(s, "utf-8").digest("hex");
const log = (s) => console.log(`[anchor ${new Date().toISOString().slice(11, 19)}] ${s}`);

async function rpc(method, params) {
  let lastErr;
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 autocourt-anchor" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      return JSON.parse(await res.text());
    } catch (e) { lastErr = e; await sleep(3000 * (i + 1)); }
  }
  throw lastErr;
}

const account = createAccount(KEYS.OPERATOR.pk);
const client = createClient({ chain, account });

async function finality(hash) {
  for (let i = 0; i < 180; i++) {
    await sleep(4000);
    const t = (await rpc("eth_getTransactionByHash", [hash])).result;
    const status = t?.status ?? t?.statusName;
    if (["FINALIZED", "CANCELED", "UNDETERMINED"].includes(status)) return t;
  }
  return null;
}

async function writeOnce(fn, args, label) {
  const est = await client.estimateTransactionFees();
  const feeValue = est.feeValue > FEE_FLOOR ? est.feeValue : FEE_FLOOR;
  const hash = await client.writeContract({
    address: CONTRACT, functionName: fn, args, value: 0n,
    fees: { distribution: est.distribution, feeValue },
  });
  log(`${label}: tx ${hash}`);
  const t = await finality(hash);
  const status = t?.status ?? t?.statusName ?? "TIMEOUT";
  const arr = t?.consensus_data?.leader_receipt ?? [];
  const leader = arr.find((x) => x?.mode !== "validator") ?? arr[0];
  log(`${label}: ${status} · ${t?.result_name ?? "?"} · leader ${leader?.execution_result ?? "?"}`);
  if (leader?.execution_result && leader.execution_result !== "SUCCESS") {
    log(`  stderr: ${String(leader?.genvm_result?.stderr ?? "").slice(-300)}`);
  }
  return { ok: status === "FINALIZED" && leader?.execution_result === "SUCCESS", hash, t };
}

async function view(fn, args) {
  return JSON.parse(String(await client.readContract({ address: CONTRACT, functionName: fn, args })));
}

// The exact bytes every validator must fetch: the committed fixture.
const fixture = readFileSync(
  fileURLToPath(new URL("../fixtures/registry/1M8GDM9AXKP042788.txt", import.meta.url)),
  "utf-8");
const expected = sha(fixture.slice(0, 8_000));
log(`fixture sha256 (first 8000 bytes) = ${expected}`);
log(`anchor url = ${ANCHOR_URL}`);

const SVC_TEXT =
  "SERVICE INVOICE 2026-03-07. Vehicle VIN 1M8GDM9AXKP042788. Odometer " +
  "reading 87,432 miles at service. Replaced front brake pads and rotors.";

const vehicle = JSON.stringify({ vin: "1M8GDM9AXKP042788", make: "Meridian", model: "GT Wagon", year: 2019, seller_account: KEYS.OPERATOR.addr.toLowerCase() });
const claims = JSON.stringify([
  { type: "MILEAGE", declared_value: "87,432 miles" },
  { type: "ACCIDENT_HISTORY", declared_value: "no recorded accidents" },
]);
await writeOnce("create_assessment", [vehicle, claims], "create");
const AID = `ac-${String((await view("get_stats", [])).assessments).padStart(6, "0")}`;
log(`assessment = ${AID}`);

await writeOnce("submit_evidence_text", [AID, JSON.stringify({
  evidence_id: "E-SVC", declared_class: "SERVICE_INVOICE",
  declared_label: "Service invoice",
  uploader_account: KEYS.OPERATOR.addr.toLowerCase(), uploader_role: "SELLER",
  file_sha256: sha("anchor demo original"), text_sha256: sha(SVC_TEXT),
  extractor_version: "extractor-1.0.0", status: "EXTRACTED", text: SVC_TEXT,
  observations: [{ doc_date: "2026-03-07", odometer_reading: 87432, odometer_unit: "MILES", source_field: "odometer line" }],
  diagnostic_codes: [], capture_date: "2026-03-07",
})], "E-SVC");

const anchor = await writeOnce("submit_anchor_item", [AID, JSON.stringify({
  evidence_id: "E-REG", declared_class: "EXTERNAL_SOURCE_RESULT",
  declared_label: "National registry extract (demo fixture)",
  url: ANCHOR_URL, expected_sha256: expected,
})], "E-REG anchor (every validator fetches)");
const regItem = await view("get_item_text", [AID, "E-REG"]);
log(`anchor entered as ${regItem.status}; lane ${regItem.lane}`);

const a = await view("get_assessment", [AID]);
const entries = a.items.map((i) => [i.evidence_id, i.file_sha256, i.text_sha256, i.extractor_version]);
entries.sort((x, y) => { for (let i = 0; i < 4; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; } return 0; });
await writeOnce("submit_assessment", [AID, sha(JSON.stringify(entries))], "seal");
const round = await writeOnce("adjudicate", [AID], "adjudicate (panel)");

console.log("\n=============== ANCHOR DEMO REPORT ===============");
console.log(`contract ${CONTRACT} · ${AID} · round tx ${round.hash}`);
const v = await view("get_verdict", [AID]);
if (v.rollup) {
  console.log(`rollup ${v.rollup} · run ${v.standing_run}/${v.total_runs}`);
  for (const c of v.claims) {
    console.log(`  ${c.claim_id} ${c.claim_type}: ${c.verdict} · conf ${c.confidence} · support [${c.support_classes}]`);
  }
  const cl1 = v.claims.find((c) => c.claim_id === "CL-01");
  if (cl1?.verdict === "VERIFIED" && cl1.support_classes.includes("INDEPENDENT")) {
    console.log("PROVEN: VERIFIED reached, and only through the INDEPENDENT anchor.");
  } else {
    console.log(`observation: CL-01 landed ${cl1?.verdict} — the panel's sufficiency/support reading decides the last step; the lane itself entered ${regItem.status}.`);
  }
} else {
  console.log(`no standing verdict (round did not survive); anchor item status: ${regItem.status}`);
}
console.log("==================================================");
