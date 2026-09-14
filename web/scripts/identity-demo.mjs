/**
 * The independent identity check, live.
 *
 *   node scripts/identity-demo.mjs <contract>
 *
 * Creates two assessments on the deployment of record. Both declare the
 * same vehicle; only the VIN differs. Nothing about the outcome comes
 * from the seller, the buyer or the operator — every validator decodes
 * the VIN at the public federal registry itself and must agree on what
 * it read.
 *
 *   HONEST LISTING  a real Honda VIN, declared as a Honda   → CONFIRMED
 *   FALSE LISTING   a VIN that decodes to a 1989 bus,
 *                   declared as a 2019 Meridian GT Wagon    → MISMATCH
 *
 * The second is the one that matters: the seller supplied every other
 * byte on that record, and the contract still caught the identity.
 */
import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { readFileSync } from "node:fs";

const RPC = process.env.GENLAYER_RPC_URL ?? "https://studio-next.genlayer.com/api";
const CONTRACT = process.argv[2];
if (!CONTRACT) {
  console.error("usage: node scripts/identity-demo.mjs <contract address>");
  process.exit(2);
}
const chain = { ...studioDevnet, name: "GenLayer Studio Next", rpcUrls: { default: { http: [RPC] } } };
const KEYS = JSON.parse(readFileSync(new URL("../../.data/keys.json", import.meta.url), "utf-8"));
const account = createAccount(KEYS.OPERATOR.pk);
const client = createClient({ chain, account });
const FEE_FLOOR = 10n ** 15n;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log(`[identity ${new Date().toISOString().slice(11, 19)}] ${s}`);

async function rpc(method, params) {
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 autocourt" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      return JSON.parse(await res.text());
    } catch (e) {
      if (i === 5) throw e;
      await sleep(3000 * (i + 1));
    }
  }
}

async function finality(hash) {
  for (let i = 0; i < 90; i++) {
    await sleep(4000);
    const t = (await rpc("eth_getTransactionByHash", [hash])).result;
    const status = t?.status ?? t?.statusName;
    if (["FINALIZED", "CANCELED", "UNDETERMINED"].includes(status)) {
      const arr = t?.consensus_data?.leader_receipt ?? [];
      const leader = arr.find((x) => x?.mode !== "validator") ?? arr[0];
      return { status, leader, votes: t?.consensus_data?.validators?.length ?? 0 };
    }
  }
  return { status: "TIMEOUT" };
}

const view = async (fn, args) =>
  JSON.parse(String(await client.readContract({ address: CONTRACT, functionName: fn, args })));

async function createAndRead(label, vin, make, model, year) {
  const est = await client.estimateTransactionFees();
  const feeValue = est.feeValue > FEE_FLOOR ? est.feeValue : FEE_FLOOR;
  const hash = await client.writeContract({
    address: CONTRACT,
    functionName: "create_assessment",
    args: [
      JSON.stringify({ vin, make, model, year, seller_account: "identity-demo-seller" }),
      JSON.stringify([{ type: "MILEAGE", declared_value: "87,432 miles" }]),
    ],
    value: 0n,
    fees: { distribution: est.distribution, feeValue },
  });
  log(`${label}: tx ${hash}`);
  const fin = await finality(hash);
  log(`${label}: ${fin.status} · leader ${fin.leader?.execution_result} · ${fin.votes} validators`);
  if (fin.status !== "FINALIZED" || fin.leader?.execution_result !== "SUCCESS") {
    return { label, vin, declared: `${year} ${make} ${model}`, failed: true, hash };
  }
  const stats = await view("get_stats", []);
  const id = `ac-${String(stats.assessments).padStart(6, "0")}`;
  const a = await view("get_assessment", [id]);
  return {
    label, id, vin, hash,
    declared: `${year} ${make} ${model}`,
    status: a.identity_status,
    registry: a.registry_fields,
  };
}

const cfg = await view("get_config", []);
log(`contract ${CONTRACT} · registry ${cfg.identity_registry}`);

const rows = [];
rows.push(await createAndRead(
  "HONEST LISTING", "1HGCM82633A004352", "Honda", "Accord", 2003));
rows.push(await createAndRead(
  "FALSE LISTING", "1M8GDM9AXKP042788", "Meridian", "GT Wagon", 2019));

console.log("\n============ INDEPENDENT IDENTITY CHECK ============");
console.log(`contract ${CONTRACT}`);
console.log(`registry ${cfg.identity_registry} — fetched by every validator itself\n`);
for (const r of rows) {
  console.log(`${r.label}  (${r.id ?? "not created"})`);
  console.log(`  VIN          ${r.vin}`);
  console.log(`  seller says  ${r.declared}`);
  if (r.failed) {
    console.log(`  RESULT       round did not finalize — tx ${r.hash}`);
    continue;
  }
  const reg = r.registry ?? {};
  console.log(`  registry says ${reg.ModelYear ?? "?"} ${reg.Make ?? "?"} ${reg.Model ?? "?"} (${reg.BodyClass ?? "?"})`);
  console.log(`  RESULT       ${r.status}`);
  console.log(`  tx           ${r.hash}`);
}
console.log("====================================================");
const ok = rows[0]?.status === "CONFIRMED" && rows[1]?.status === "MISMATCH";
console.log(ok
  ? "As designed: the honest listing is confirmed, the false one is caught —\nby a source neither party controls, on a record the seller otherwise wrote."
  : "UNEXPECTED — see the statuses above.");
process.exit(ok ? 0 : 1);
