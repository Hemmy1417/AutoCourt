/**
 * The disposable-deploy calldata probe (ARCHITECTURE §1, §4.6).
 *
 *   node scripts/probe-calldata.mjs
 *
 * On GenLayer Studio Next, with an ephemeral faucet-funded account:
 *   1. deploy contracts/probe_calldata.py (a throwaway),
 *   2. write blobs of ascending size until the transport refuses,
 *      confirming each stored blob by digest read-back,
 *   3. deploy contracts/autocourt_assessment.py (also a throwaway, empty
 *      allowlist) and drive its REAL write shapes at their caps:
 *      create_assessment, a maximum-size submit_evidence_text, seal.
 *
 * Every write gets exactly ONE attempt (a lost response is re-checked by
 * reading state, never by resubmitting blind). The account is ephemeral
 * and never printed beyond its address.
 */
import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RPC = process.env.GENLAYER_RPC_URL ?? "https://studio-next.genlayer.com/api";
const chain = { ...studioDevnet, name: "GenLayer Studio Next", rpcUrls: { default: { http: [RPC] } } };
const FEE_FLOOR = 10n ** 15n;
const PROBE_SOURCE = fileURLToPath(new URL("../../contracts/probe_calldata.py", import.meta.url));
const REAL_SOURCE = fileURLToPath(new URL("../../contracts/autocourt_assessment.py", import.meta.url));
const SIZES = [2_000, 4_000, 6_000, 8_000, 10_000, 12_000, 16_000, 24_000, 32_000];
const CALL_TIMEOUT_MS = 45_000;
const FINALITY_TRIES = 90; // × 4s ≈ 6 minutes per tx

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash("sha256").update(s, "utf-8").digest("hex");
const log = (s) => console.log(`[probe ${new Date().toISOString().slice(11, 19)}] ${s}`);

async function rpc(method, params) {
  // Status polls are idempotent, so transient 502-HTML answers are
  // retried; WRITES never come through here and keep one attempt each.
  let lastErr;
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 autocourt-probe" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const text = await res.text();
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      await sleep(3000 * (i + 1));
    }
  }
  throw lastErr;
}

function withTimeout(promise, ms, what) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${what}: no response in ${ms}ms`)), ms)),
  ]);
}

async function finality(hash) {
  for (let i = 0; i < FINALITY_TRIES; i++) {
    await sleep(4000);
    const t = (await rpc("eth_getTransactionByHash", [hash])).result;
    const status = t?.status ?? t?.statusName;
    if (status === "FINALIZED") {
      const arr = t.consensus_data?.leader_receipt ?? [];
      const leader = arr.find((x) => x?.mode !== "validator") ?? arr[0];
      return { status, result: t.result_name, leader: leader?.execution_result, tx: t };
    }
    if (status === "CANCELED" || status === "UNDETERMINED") return { status };
  }
  return { status: "TIMEOUT" };
}

async function writeOnce(client, address, functionName, args, label) {
  // ONE attempt: estimation + send. Refusal at estimation is a refusal.
  let est;
  try {
    est = await withTimeout(client.estimateTransactionFees(), CALL_TIMEOUT_MS, `${label} estimate`);
  } catch (e) {
    return { ok: false, phase: "estimate", error: String(e?.message ?? e) };
  }
  const feeValue = est.feeValue > FEE_FLOOR ? est.feeValue : FEE_FLOOR;
  let hash;
  try {
    hash = await withTimeout(
      client.writeContract({
        address,
        functionName,
        args,
        value: 0n,
        fees: { distribution: est.distribution, feeValue },
      }),
      CALL_TIMEOUT_MS,
      `${label} send`,
    );
  } catch (e) {
    return { ok: false, phase: "send", error: String(e?.message ?? e) };
  }
  const fin = await finality(hash);
  return { ok: fin.status === "FINALIZED" && fin.leader === "SUCCESS", hash, ...fin };
}

async function view(client, address, functionName, args) {
  return withTimeout(
    client.readContract({ address, functionName, args }),
    CALL_TIMEOUT_MS,
    `view ${functionName}`,
  );
}

async function deploy(client, sourcePath, args, label) {
  const code = readFileSync(sourcePath, "utf-8");
  if (code.includes("\r")) throw new Error(`${label}: CR bytes in source — normalize to LF`);
  const est = await client.estimateTransactionFees();
  const feeValue = est.feeValue > FEE_FLOOR ? est.feeValue : FEE_FLOOR;
  const hash = await client.deployContract({ code, args, fees: { distribution: est.distribution, feeValue } });
  log(`${label}: deploy tx ${hash}`);
  const fin = await finality(hash);
  if (fin.status !== "FINALIZED" || fin.leader !== "SUCCESS") {
    throw new Error(`${label}: deploy ${fin.status} leader=${fin.leader ?? "?"}`);
  }
  const address = fin.tx.data?.contract_address;
  log(`${label}: CONTRACT ${address}`);
  return address;
}

// A blob that LOOKS like our real payloads: JSON with text inside.
function blobOf(size) {
  const filler = "The odometer reads 87,432 miles at service on 2026-03-07. ";
  let text = "";
  while (text.length < size) text += filler;
  const shell = { kind: "probe", seq: size, text: "" };
  const overhead = JSON.stringify(shell).length;
  shell.text = text.slice(0, Math.max(0, size - overhead));
  let out = JSON.stringify(shell);
  while (out.length < size) { shell.text += "x"; out = JSON.stringify(shell); }
  return out.slice(0, size);
}

const account = createAccount();
const client = createClient({ chain, account });
log(`ephemeral account ${account.address} on chain ${chain.id} via ${RPC}`);

const fund = await rpc("sim_fundAccount", [account.address, 100]);
log(`faucet: ${JSON.stringify(fund.result ?? fund.error)}`);
await sleep(4000);
const bal = await rpc("eth_getBalance", [account.address, "latest"]);
log(`balance: ${BigInt(bal.result ?? "0x0")}`);

// ── stage 1: raw ceiling on the throwaway probe ─────────────────────────────
const probeAddr = await deploy(client, PROBE_SOURCE, [], "probe");
const rows = [];
let ceilingHit = false;
for (const size of SIZES) {
  if (ceilingHit) { rows.push({ size, verdict: "SKIPPED (ceiling already found)" }); continue; }
  const blob = blobOf(size);
  const digest = sha(blob);
  const w = await writeOnce(client, probeAddr, "store", [blob], `store(${size})`);
  if (!w.ok) {
    rows.push({ size, verdict: `REFUSED at ${w.phase ?? w.status}: ${String(w.error ?? w.status).slice(0, 120)}` });
    ceilingHit = true;
    continue;
  }
  let stored = -1;
  try { stored = Number(await view(client, probeAddr, "stored_length", [digest])); } catch {}
  rows.push({
    size,
    verdict: stored === size ? `FINALIZED + read back ${stored} chars (tx ${w.hash})` : `FINALIZED but read-back ${stored} ≠ ${size} (tx ${w.hash})`,
  });
  log(`size ${size}: ${rows[rows.length - 1].verdict}`);
}

// ── stage 2: the real contract's actual write shapes at their caps ──────────
log("stage 2: real write shapes on a disposable autocourt deploy");
const acAddr = await deploy(client, REAL_SOURCE, ["[]"], "autocourt (disposable)");
const vehicle = JSON.stringify({
  vin: "1M8GDM9AXKP042788", make: "Meridian", model: "GT Wagon", year: 2019,
  seller_account: "probe-seller",
});
const claims = JSON.stringify([
  { type: "MILEAGE", declared_value: "87,432 miles" },
  { type: "ACCIDENT_HISTORY", declared_value: "no recorded accidents" },
]);
const created = await writeOnce(client, acAddr, "create_assessment", [vehicle, claims], "create_assessment");
log(`create_assessment: ${created.ok ? "ok" : JSON.stringify(created).slice(0, 200)}`);
let realShape = "NOT RUN";
if (created.ok) {
  const aid = "ac-000001";
  // A maximum-size item: 6,000 chars of text inside the full JSON arg.
  let text = "";
  while (text.length < 6_000) text += "Service record line, odometer 87,432 miles, dated 2026-03-07. ";
  text = text.slice(0, 6_000);
  const itemJson = JSON.stringify({
    evidence_id: "E-MAX",
    declared_class: "SERVICE_INVOICE",
    declared_label: "Probe max-size item",
    uploader_account: "probe-seller",
    uploader_role: "SELLER",
    file_sha256: sha("probe original bytes"),
    text_sha256: sha(text),
    extractor_version: "extractor-1.0.0",
    status: "EXTRACTED",
    text,
    observations: [{ doc_date: "2026-03-07", odometer_reading: 87432, odometer_unit: "MILES", source_field: "probe" }],
    diagnostic_codes: ["P0301"],
    capture_date: "2026-03-07",
  });
  log(`submit_evidence_text arg length: ${itemJson.length} chars`);
  const item = await writeOnce(client, acAddr, "submit_evidence_text", [aid, itemJson], "submit_evidence_text(max)");
  if (item.ok) {
    const stored = JSON.parse(await view(client, acAddr, "get_item_text", [aid, "E-MAX"]));
    const roundTrip = stored.text === text && stored.text_sha256 === sha(text);
    const cfg = JSON.parse(await view(client, acAddr, "get_config", []));
    realShape = `submit_evidence_text ${itemJson.length}-char arg FINALIZED (tx ${item.hash}); ` +
      `read-back ${roundTrip ? "byte-identical" : "MISMATCH"}; get_config per_item_text_cap=${cfg.per_item_text_cap}`;
  } else {
    realShape = `submit_evidence_text REFUSED: ${JSON.stringify(item).slice(0, 200)}`;
  }
}

console.log("\n================ CALLDATA PROBE REPORT ================");
console.log(`network chain ${chain.id} · rpc ${RPC}`);
console.log(`probe contract   ${probeAddr} (disposable)`);
console.log(`real contract    ${acAddr} (disposable)`);
for (const r of rows) console.log(`  ${String(r.size).padStart(6)} chars: ${r.verdict}`);
console.log(`  real shape: ${realShape}`);
console.log("=======================================================");
