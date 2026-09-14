/**
 * (Written for the disposable pre-canonical deploy, before writes were bound
 * to their signer; kept as the record of that pass.)
 *
 * The validator-diversity diagnostic pass (STANDARDS-MAP §5): one full
 * adjudication round on the DISPOSABLE deploy, before anything canonical.
 * StudioNet validators span model families; this measures whether the
 * panel prompt + word-token grounding + drop-and-downgrade converge, and
 * captures every [DISAGREE]/[DOWNGRADE] line from validator stdout.
 *
 *   node scripts/diagnostic-round.mjs [contract] [assessmentId]
 *
 * Defaults to the probe run's disposable deploy and its ac-000001.
 * Writes get exactly ONE attempt each.
 */
import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { createHash } from "node:crypto";

const RPC = process.env.GENLAYER_RPC_URL ?? "https://studio-next.genlayer.com/api";
const chain = { ...studioDevnet, name: "GenLayer Studio Next", rpcUrls: { default: { http: [RPC] } } };
const CONTRACT = process.argv[2] ?? "0xE71760C2097A6DBc92124ca73eECf390AB7609C9";
let AID = process.argv[3] ?? "";
const FEE_FLOOR = 10n ** 15n;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash("sha256").update(s, "utf-8").digest("hex");
const log = (s) => console.log(`[diag ${new Date().toISOString().slice(11, 19)}] ${s}`);

async function rpc(method, params) {
  let lastErr;
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 autocourt-diag" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      return JSON.parse(await res.text());
    } catch (e) {
      lastErr = e;
      await sleep(3000 * (i + 1));
    }
  }
  throw lastErr;
}

async function finality(hash, tries = 150) {
  for (let i = 0; i < tries; i++) {
    await sleep(4000);
    const t = (await rpc("eth_getTransactionByHash", [hash])).result;
    const status = t?.status ?? t?.statusName;
    if (["FINALIZED", "CANCELED", "UNDETERMINED"].includes(status)) return t;
    if (i % 10 === 9) log(`  … ${status ?? "pending"}`);
  }
  return null;
}

const account = createAccount();
const client = createClient({ chain, account });

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
  log(`${label}: ${status} · result ${t?.result_name ?? "?"} · leader ${leader?.execution_result ?? "?"}`);
  return { t, status, leader, hash };
}

async function view(fn, args) {
  return JSON.parse(String(await client.readContract({ address: CONTRACT, functionName: fn, args })));
}

function stdoutOf(receipt) {
  const out = [];
  for (const r of receipt?.consensus_data?.leader_receipt ?? []) {
    const so = r?.genvm_result?.stdout ?? "";
    if (so) out.push({ mode: r.mode ?? "leader", stdout: String(so) });
  }
  for (const v of receipt?.consensus_data?.validators ?? []) {
    const so = v?.genvm_result?.stdout ?? "";
    if (so) out.push({ mode: "validator", stdout: String(so) });
  }
  return out;
}

log(`diagnostic on DISPOSABLE ${CONTRACT} · as ${account.address}`);
const fund = await rpc("sim_fundAccount", [account.address, 100]);
log(`faucet: ${JSON.stringify(fund.result ?? fund.error).slice(0, 80)}`);
await sleep(4000);

if (!AID) {
  const vehicle = JSON.stringify({ vin: "1M8GDM9AXKP042788", make: "Meridian", model: "GT Wagon", year: 2019, seller_account: "diag-seller" });
  const claims = JSON.stringify([
    { type: "MILEAGE", declared_value: "87,432 miles" },
    { type: "ACCIDENT_HISTORY", declared_value: "no recorded accidents" },
  ]);
  await writeOnce("create_assessment", [vehicle, claims], "create");
  const stats = await view("get_stats", []);
  AID = `ac-${String(stats.assessments).padStart(6, "0")}`;
  log(`created ${AID}`);
  const SVC_TEXT =
    "SERVICE INVOICE 2026-03-07. Vehicle VIN 1M8GDM9AXKP042788. Odometer " +
    "reading 87,432 miles at service. Replaced front brake pads and " +
    "rotors. Next service due at 92,000 miles.";
  const svc = {
    evidence_id: "E-SVC",
    declared_class: "SERVICE_INVOICE",
    declared_label: "Service invoice",
    uploader_account: "diag-seller",
    uploader_role: "SELLER",
    file_sha256: sha("diag original bytes svc"),
    text_sha256: sha(SVC_TEXT),
    extractor_version: "extractor-1.0.0",
    status: "EXTRACTED",
    text: SVC_TEXT,
    observations: [{ doc_date: "2026-03-07", odometer_reading: 87432, odometer_unit: "MILES", source_field: "odometer line" }],
    diagnostic_codes: [],
    capture_date: "2026-03-07",
  };
  await writeOnce("submit_evidence_text", [AID, JSON.stringify(svc)], "submit E-SVC");
}

let a = await view("get_assessment", [AID]);
log(`state ${a.state} · ${a.items.length} item(s) on record`);

// A second, human-shaped item so the panel has a real cross-document
// record: history text supporting CL-02 with an earlier odometer row.
const HIST_TEXT =
  "VEHICLE HISTORY RECORD. No accident records found for this vehicle. " +
  "Odometer reported 86,900 miles on 2026-01-15. Two previous owners on " +
  "record. Registered private sale pending.";
if (a.state === "OPEN" && !a.items.some((i) => i.evidence_id === "E-HIST")) {
  const item = {
    evidence_id: "E-HIST",
    declared_class: "VEHICLE_HISTORY_RECORD",
    declared_label: "History report",
    uploader_account: "diag-buyer",
    uploader_role: "BUYER",
    file_sha256: sha("diag original bytes hist"),
    text_sha256: sha(HIST_TEXT),
    extractor_version: "extractor-1.0.0",
    status: "EXTRACTED",
    text: HIST_TEXT,
    observations: [{ doc_date: "2026-01-15", odometer_reading: 86900, odometer_unit: "MILES", source_field: "odometer line" }],
    diagnostic_codes: [],
    capture_date: "2026-01-15",
  };
  await writeOnce("submit_evidence_text", [AID, JSON.stringify(item)], "submit E-HIST");
}

// Seal over whatever the contract stores (recompute the root its way).
a = await view("get_assessment", [AID]);
if (a.state === "OPEN") {
  const entries = [];
  for (const it of a.items) {
    entries.push([it.evidence_id, it.file_sha256, it.text_sha256, it.extractor_version]);
  }
  entries.sort((x, y) => {
    for (let i = 0; i < 4; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; }
    return 0;
  });
  const root = sha(JSON.stringify(entries));
  await writeOnce("submit_assessment", [AID, root], "seal");
}

// THE ROUND. This is the measurement.
const round = await writeOnce("adjudicate", [AID], "adjudicate");

console.log("\n================ DIAGNOSTIC ROUND REPORT ================");
console.log(`contract (disposable) ${CONTRACT} · ${AID} · tx ${round.hash}`);
console.log(`status ${round.status} · result ${round.t?.result_name ?? "?"} · leader ${round.leader?.execution_result ?? "?"}`);

const streams = stdoutOf(round.t);
let flagged = 0;
for (const s of streams) {
  const lines = s.stdout.split("\n").filter((l) => l.includes("[DISAGREE]") || l.includes("[DOWNGRADE]"));
  for (const l of lines) { console.log(`  ${s.mode}: ${l.slice(0, 220)}`); flagged++; }
}
console.log(flagged === 0 ? "  no [DISAGREE]/[DOWNGRADE] lines in any captured stdout" : `  ${flagged} diagnostic line(s) above`);

const finalVerdict = await view("get_verdict", [AID]);
if (finalVerdict.rollup) {
  const verdict = finalVerdict;
  console.log(`standing run ${verdict.standing_run}/${verdict.total_runs} · rollup ${verdict.rollup}`);
  for (const c of verdict.claims) {
    console.log(`  ${c.claim_id} ${c.claim_type}: ${c.verdict} · confidence ${c.confidence} · support [${c.support_classes}] contra [${c.contradict_classes}]`);
  }
  console.log(`flags ${JSON.stringify(verdict.flags)} · inspection ${verdict.inspection_required}`);
} else {
  console.log(`no standing verdict (round ${round.status}); the record is unchanged`);
  const stderr = String(round.leader?.genvm_result?.stderr ?? "");
  if (stderr) console.log(`leader stderr tail: ${stderr.slice(-600)}`);
}
console.log("=========================================================");
