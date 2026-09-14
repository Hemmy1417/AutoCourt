/**
 * Deploy `contracts/autocourt_assessment.py` to GenLayer Studio Next and
 * verify the bytes.
 *
 *   node scripts/deploy.mjs keys            create .data/keys.json (operator wallet) if absent, fund it
 *   node scripts/deploy.mjs                 deploy with the demo anchor allowlist, wait, print the address
 *   node scripts/deploy.mjs disposable      deploy a THROWAWAY (empty allowlist) for diagnostics
 *   node scripts/deploy.mjs verify 0x…      fetch the deployed source and diff it byte-for-byte
 *
 * Signs with the OPERATOR key in .data/keys.json (gitignored). Studio
 * Next refuses a transaction without a fee distribution and a non-zero
 * deposit, so the estimate is taken explicitly and floored.
 */
import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";

const RPC = process.env.GENLAYER_RPC_URL ?? "https://studio-next.genlayer.com/api";
const chain = { ...studioDevnet, name: "GenLayer Studio Next", rpcUrls: { default: { http: [RPC] } } };
const SOURCE = fileURLToPath(new URL("../../contracts/autocourt_assessment.py", import.meta.url));
const KEYS_PATH = fileURLToPath(new URL("../../.data/keys.json", import.meta.url));
const FEE_FLOOR = 10n ** 15n;

// The anchor allowlist, visible in get_config and stated in the README.
// api.nhtsa.gov is a real public authority: the US government's vehicle
// safety recall records, which the render probe (docs/PROBE-REPORT.md)
// showed every validator reaching and agreeing on. Commit-pinned GitHub raw
// stays for documents no public API publishes, standing in for a registry.
const ANCHOR_ALLOWLIST = ["api.nhtsa.gov", "raw.githubusercontent.com"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash("sha256").update(s, "utf-8").digest("hex");

async function rpc(method, params) {
  let lastErr;
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 autocourt-deploy" },
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

const [cmd, arg] = process.argv.slice(2);

if (cmd === "keys") {
  if (existsSync(KEYS_PATH)) {
    const keys = JSON.parse(readFileSync(KEYS_PATH, "utf-8"));
    console.log(`keys exist — operator ${keys.OPERATOR.addr}`);
  } else {
    const pk = "0x" + randomBytes(32).toString("hex");
    const account = createAccount(pk);
    mkdirSync(fileURLToPath(new URL("../../.data", import.meta.url)), { recursive: true });
    writeFileSync(KEYS_PATH, JSON.stringify({ OPERATOR: { pk, addr: account.address } }, null, 2));
    console.log(`operator created: ${account.address} (key in .data/keys.json — gitignored, never printed)`);
  }
  const keys = JSON.parse(readFileSync(KEYS_PATH, "utf-8"));
  const fund = await rpc("sim_fundAccount", [keys.OPERATOR.addr, 500]);
  console.log(`faucet: ${JSON.stringify(fund.result ?? fund.error).slice(0, 90)}`);
  await sleep(4000);
  const bal = await rpc("eth_getBalance", [keys.OPERATOR.addr, "latest"]);
  console.log(`balance: ${BigInt(bal.result ?? "0x0")}`);
} else if (cmd === "verify") {
  const r = await rpc("gen_getContractCode", [arg]);
  const raw = typeof r.result === "string" ? r.result : (r.result?.code ?? "");
  const live = raw.startsWith("# ") ? raw : Buffer.from(raw, "base64").toString("utf-8");
  const repo = readFileSync(SOURCE, "utf-8");
  console.log(`live  sha256 ${sha(live)}  (${live.length} chars)`);
  console.log(`repo  sha256 ${sha(repo)}  (${repo.length} chars)`);
  if (live !== repo) {
    const a = live.split("\n"), b = repo.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) { console.log(`first difference at line ${i + 1}\n  live: ${a[i]}\n  repo: ${b[i]}`); break; }
    }
    console.error("verify: the deployed source does NOT match the repo file");
    process.exit(1);
  }
  console.log("verify: byte-for-byte identical");
} else {
  const disposable = cmd === "disposable";
  const allowlist = disposable ? [] : ANCHOR_ALLOWLIST;
  const keys = JSON.parse(readFileSync(KEYS_PATH, "utf-8"));
  const account = createAccount(keys.OPERATOR.pk);
  const client = createClient({ chain, account });
  const code = readFileSync(SOURCE, "utf-8");
  if (code.includes("\r")) throw new Error("contract carries CR bytes — normalize to LF before deploying");
  console.log(`deploying${disposable ? " DISPOSABLE" : ""} (sha256 ${sha(code)}) as ${account.address} on chain ${chain.id}`);
  console.log(`anchor allowlist: ${JSON.stringify(allowlist)}`);
  const est = await client.estimateTransactionFees();
  const feeValue = est.feeValue > FEE_FLOOR ? est.feeValue : FEE_FLOOR;
  const hash = await client.deployContract({
    code,
    args: [JSON.stringify(allowlist)],
    fees: { distribution: est.distribution, feeValue },
  });
  console.log(`deploy tx ${hash}`);
  for (let i = 0; i < 90; i++) {
    await sleep(4000);
    const t = (await rpc("eth_getTransactionByHash", [hash])).result;
    const status = t?.status ?? t?.statusName;
    if (status === "FINALIZED") {
      const arr = t.consensus_data?.leader_receipt ?? [];
      const leader = arr.find((x) => x?.mode !== "validator") ?? arr[0];
      console.log(`FINALIZED — ${t.result_name} — leader ${leader?.execution_result}`);
      if (leader?.execution_result !== "SUCCESS") {
        console.error(String(leader?.genvm_result?.stderr ?? "").slice(-1500));
        process.exit(1);
      }
      console.log(`CONTRACT ${t.data?.contract_address}`);
      process.exit(0);
    }
    if (status === "CANCELED" || status === "UNDETERMINED") { console.error(`deploy ${status}`); process.exit(1); }
    if (i % 5 === 4) console.log(`  … ${status ?? "pending"}`);
  }
  console.error("no finality after 6 minutes — check the hash on the explorer");
  process.exit(1);
}
