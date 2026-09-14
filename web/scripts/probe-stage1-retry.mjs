/**
 * Stage-1 retry: the size ladder against the ALREADY-DEPLOYED disposable
 * probe contract (first run's rung 1 died on a local transport flake, not
 * an RPC refusal). Writes 8,000 and 10,000-char blobs — bracketing the
 * real contract's worst-case item write (~7.6KB) — and reads each back.
 */
import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { createHash } from "node:crypto";

const RPC = process.env.GENLAYER_RPC_URL ?? "https://studio-next.genlayer.com/api";
const chain = { ...studioDevnet, name: "GenLayer Studio Next", rpcUrls: { default: { http: [RPC] } } };
const PROBE = process.argv[2] ?? "0x17e1eCe561Ae496B12AC709c406247a83315010A";
const SIZES = (process.argv[3] ?? "8000,10000").split(",").map(Number);
const FEE_FLOOR = 10n ** 15n;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash("sha256").update(s, "utf-8").digest("hex");
const log = (s) => console.log(`[probe ${new Date().toISOString().slice(11, 19)}] ${s}`);

async function rpc(method, params) {
  let lastErr;
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 autocourt-probe" },
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

async function finality(hash) {
  for (let i = 0; i < 90; i++) {
    await sleep(4000);
    const t = (await rpc("eth_getTransactionByHash", [hash])).result;
    const status = t?.status ?? t?.statusName;
    if (status === "FINALIZED") {
      const arr = t.consensus_data?.leader_receipt ?? [];
      const leader = arr.find((x) => x?.mode !== "validator") ?? arr[0];
      return { status, leader: leader?.execution_result };
    }
    if (status === "CANCELED" || status === "UNDETERMINED") return { status };
  }
  return { status: "TIMEOUT" };
}

function blobOf(size) {
  let text = "";
  while (text.length < size) text += "Probe filler: odometer 87,432 miles recorded 2026-03-07. ";
  return JSON.stringify({ kind: "probe", text: text.slice(0, size - 40) }).slice(0, size);
}

const account = createAccount();
const client = createClient({ chain, account });
log(`ephemeral ${account.address} → probe ${PROBE}`);
const fund = await rpc("sim_fundAccount", [account.address, 100]);
log(`faucet: ${JSON.stringify(fund.result ?? fund.error)}`);
await sleep(4000);

for (const size of SIZES) {
  const blob = blobOf(size);
  const digest = sha(blob);
  try {
    const est = await client.estimateTransactionFees();
    const feeValue = est.feeValue > FEE_FLOOR ? est.feeValue : FEE_FLOOR;
    const hash = await client.writeContract({
      address: PROBE, functionName: "store", args: [blob], value: 0n,
      fees: { distribution: est.distribution, feeValue },
    });
    log(`store(${size}) tx ${hash}`);
    const fin = await finality(hash);
    let readBack = -1;
    try { readBack = Number(await client.readContract({ address: PROBE, functionName: "stored_length", args: [digest] })); } catch {}
    log(`  → ${fin.status} leader=${fin.leader ?? "?"} read-back=${readBack}`);
  } catch (e) {
    log(`store(${size}) FAILED AT SEND: ${String(e?.message ?? e).slice(0, 150)}`);
  }
}
log("done");
