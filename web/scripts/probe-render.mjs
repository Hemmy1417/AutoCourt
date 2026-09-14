/**
 * The disposable render probe: what do validators read from a candidate
 * independent source?
 *
 *   node scripts/probe-render.mjs [url ...]
 *
 * On GenLayer Studio Next, with an ephemeral faucet-funded account:
 *   1. deploy contracts/probe_render.py (a throwaway),
 *   2. for each URL, one consensus round in which every validator renders
 *      the page and must agree on its digest,
 *   3. read back the exact text the round stored, and compare it with the
 *      raw response and with the app's reproduction of the webdriver's
 *      whitespace normalization.
 *
 * The account is ephemeral and never printed beyond its address.
 */
import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RPC = process.env.GENLAYER_RPC_URL ?? "https://studio-next.genlayer.com/api";
const chain = { ...studioDevnet, name: "GenLayer Studio Next", rpcUrls: { default: { http: [RPC] } } };
const FEE_FLOOR = 10n ** 15n;
const SOURCE = fileURLToPath(new URL("../../contracts/probe_render.py", import.meta.url));
const OUT = process.env.PROBE_OUT ?? "probe-render.json";

const URLS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "https://raw.githubusercontent.com/Hemmy1417/AutoCourt/76a39eea547c8286dcdaf360899303f9c75b481b/fixtures/registry/1HGCM82633A004352.txt",
      "https://api.nhtsa.gov/recalls/recallsByVehicle?make=honda&model=accord&modelYear=2003",
      "https://api.nhtsa.gov/recalls/campaignNumber?campaignNumber=15V320000",
    ];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const log = (s) => console.log(`[render ${new Date().toISOString().slice(11, 19)}] ${s}`);

/** GenVM webdriver normalizeWhitespace, as web/lib/evidence/anchor.ts reproduces it. */
const rendered = (text) =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .join("\n")
    .replace(/\n{2,}/g, "\n\n");

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
  for (let i = 0; i < 120; i++) {
    await sleep(4000);
    const t = (await rpc("eth_getTransactionByHash", [hash])).result;
    const status = t?.status ?? t?.statusName;
    if (["FINALIZED", "CANCELED", "UNDETERMINED"].includes(status)) {
      const leader = t.consensus_data?.leader_receipt?.[0];
      const stdout = (t.consensus_data?.validators ?? [])
        .map((v) => String(v?.genvm_result?.stdout ?? ""))
        .filter((s) => s.includes("[DISAGREE]"));
      return { status, result: t.result_name, leader: leader?.execution_result, stdout, tx: t };
    }
  }
  return { status: "TIMEOUT" };
}

const account = createAccount();
const client = createClient({ chain, account });
log(`ephemeral account ${account.address}`);
await rpc("sim_fundAccount", [account.address, 5e18]);
await sleep(3000);

const code = readFileSync(SOURCE, "utf8");
const deployEst = await client.estimateTransactionFees();
const deployHash = await client.deployContract({
  code,
  args: [],
  fees: { distribution: deployEst.distribution, feeValue: deployEst.feeValue > FEE_FLOOR ? deployEst.feeValue : FEE_FLOOR },
});
log(`deploy tx ${deployHash}`);
const deployed = await finality(deployHash);
const address = deployed.tx?.data?.contract_address;
if (deployed.status !== "FINALIZED" || deployed.leader !== "SUCCESS" || !address) {
  throw new Error(`deploy ${deployed.status} leader=${deployed.leader}`);
}
log(`probe contract ${address}`);

const report = { contract: address, deployTx: deployHash, runs: [] };
for (const [i, url] of URLS.entries()) {
  const key = `k${i}`;
  const raw = await (await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } })).text();
  const est = await client.estimateTransactionFees();
  const hash = await client.writeContract({
    address,
    functionName: "probe",
    args: [key, url],
    value: 0n,
    fees: { distribution: est.distribution, feeValue: est.feeValue > FEE_FLOOR ? est.feeValue : FEE_FLOOR },
  });
  log(`${url}\n  tx ${hash}`);
  const fin = await finality(hash);
  const stored = JSON.parse(String((await client.readContract({ address, functionName: "reading", args: [key] })) || "{}"));
  const text = stored.text ?? "";
  const run = {
    url,
    tx: hash,
    status: fin.status,
    consensus: fin.result,
    leader: fin.leader,
    disagreements: fin.stdout,
    reachable: stored.reachable,
    error: stored.error,
    validatorDigest: stored.digest,
    validatorLength: stored.length,
    rawLength: raw.length,
    rawDigest: sha(raw),
    appRenderedDigest: sha(rendered(raw)),
    appReproducesValidators: sha(rendered(raw)) === stored.digest,
    firstDifference: (() => {
      const mine = rendered(raw);
      const n = Math.min(mine.length, text.length);
      for (let j = 0; j < n; j++) if (mine[j] !== text[j]) return { at: j, app: mine.slice(j, j + 80), validators: text.slice(j, j + 80) };
      return mine.length === text.length ? null : { at: n, app: mine.slice(n, n + 80), validators: text.slice(n, n + 80) };
    })(),
    head: text.slice(0, 400),
  };
  report.runs.push(run);
  log(`  ${fin.status} ${fin.result} leader=${fin.leader} reachable=${stored.reachable} len=${stored.length} app-matches=${run.appReproducesValidators}`);
}
writeFileSync(OUT, JSON.stringify(report, null, 2));
log(`report written to ${OUT}`);
