/**
 * MAX_RUNS_PER_ASSESSMENT, live — the bound that makes an appeal a right
 * rather than a siege.
 *
 *   node scripts/prove-runs-cap.mjs      (server + dev-db + worker up)
 *
 * A record holds at most 4 runs: one adjudication and three appeals.
 * Without a bound, a party who dislikes a verdict can keep appealing
 * until a panel drifts their way and the record never settles. The cap
 * was covered by direct tests and by a unit test over the acts layer; no
 * live record had ever actually reached it.
 *
 * This drives one record to the cap through the product — adjudicate,
 * then three appeals, each carrying a genuinely new finding — and then
 * tests BOTH places the refusal has to hold:
 *
 *   THE APP       a fifth run is refused before anything is written, so
 *                 no evidence is filed for an appeal that could never
 *                 happen.
 *   THE CONTRACT  and it refuses for itself, in its own words, to an
 *                 operator key calling readjudicate directly — which is
 *                 the enforcement that actually matters, because the app
 *                 is not the only thing that can call it.
 */
import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { readFileSync } from "node:fs";

// The COMPILED client, the same one the app and the worker use. Run
// `npx tsc -b` first; plain Node cannot load the TypeScript source.
import { AutoCourtChain } from "../packages/genlayer-client/dist/index.js";
import { Actor, BASE, asserter, logger, settled, upload } from "./lib/harness.mjs";

const RPC = process.env.GENLAYER_RPC_URL ?? "https://studio-next.genlayer.com/api";
const log = logger("runs");
const { hard, failures } = asserter(log);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = (actor, id, label) => settled(actor, id, label, { log });

// ── the cap, read from the contract rather than remembered ──────────────────
const { config, contractAddress: CONTRACT } =
  await (await fetch(`${BASE}/api/config`)).json();
const MAX = config.max_runs_per_assessment;
log(`the contract allows ${MAX} runs per assessment`);
hard(Number.isInteger(MAX) && MAX > 1, "the contract publishes its own run limit");

const seller = await new Actor("Runs Seller").signIn();
const vehicle = await seller.api("/api/vehicles", {
  method: "POST",
  body: JSON.stringify({
    vin: "1HGCM82633A004352", make: "Honda", model: "Accord", year: 2003,
    claims: [{ type: "CONDITION", declaredValue: "no accident damage, bodywork original" }],
  }),
});
const a = await seller.api("/api/assessments", {
  method: "POST", body: JSON.stringify({ vehicleId: vehicle.id }),
});
log(`record ${a.id}`);

await upload(seller, a.id, {
  filename: "declaration.txt",
  text: "SELLER DECLARATION 2026-04-01. VIN 1HGCM82633A004352, Honda Accord. " +
        "Bodywork is original. No accident damage. No repairs to structure.",
  declaredClass: "SELLER_DECLARATION",
  declaredLabel: "Seller declaration",
  captureDate: "2026-04-01",
});
await seller.api(`/api/assessments/${a.id}/submit`, { method: "POST" });
await wait(seller, a.id, "submit");
await seller.api(`/api/assessments/${a.id}/adjudicate`, { method: "POST" });
const afterFirst = await wait(seller, a.id, "run 1");
log(`run 1 standing · ${(await seller.api(`/api/assessments/${a.id}/verdict`)).verdict.rollup}`);

// ── appeals until the record is full ────────────────────────────────────────
// Each appeal carries a genuinely new finding. An appeal on nothing new
// is refused for a different reason and would not test the cap.
const APPEALS = [
  {
    filename: "panel-gap.txt",
    text: "INDEPENDENT INSPECTION 2026-04-20. VIN 1HGCM82633A004352. Nearside " +
          "front wing panel gap measures 7mm against 4mm on the offside. " +
          "Consistent with a panel having been removed and refitted.",
    declaredClass: "MECHANIC_REPORT",
    declaredLabel: "Panel gap measurement",
    captureDate: "2026-04-20",
    grounds: "An independent inspection measured a panel gap the first panel never saw.",
  },
  {
    filename: "paint-depth.txt",
    text: "PAINT DEPTH SURVEY 2026-05-02. VIN 1HGCM82633A004352. Coating " +
          "thickness on the nearside front wing reads 240 microns against a " +
          "factory range of 95-130 microns elsewhere on the shell.",
    declaredClass: "MECHANIC_REPORT",
    declaredLabel: "Paint depth survey",
    captureDate: "2026-05-02",
    grounds: "A paint depth survey shows refinishing on the same panel.",
  },
  {
    filename: "parts-invoice.txt",
    text: "PARTS INVOICE 2026-05-14. VIN 1HGCM82633A004352. Supplied: nearside " +
          "front wing, headlamp bracket, wing liner. Fitted by an approved " +
          "bodyshop. Labour: 6.5 hours panel and paint.",
    declaredClass: "SERVICE_INVOICE",
    declaredLabel: "Bodyshop parts invoice",
    captureDate: "2026-05-14",
    grounds: "A bodyshop invoice names the replaced panel outright.",
  },
];

let runs = 1;
for (const { grounds, ...doc } of APPEALS) {
  if (runs >= MAX) break;
  const item = await upload(seller, a.id, doc);
  await seller.api(`/api/assessments/${a.id}/appeal`, {
    method: "POST",
    body: JSON.stringify({ grounds, newEvidenceIds: [item.id] }),
  });
  runs += 1;
  log(`appeal ${runs - 1} filed — ${doc.declaredLabel}`);
  await wait(seller, a.id, `run ${runs}`);
}

const full = await seller.api(`/api/assessments/${a.id}/verdict`);
log(`record full: standing run ${full.verdict.standing_run}/${full.verdict.total_runs} · ${full.verdict.rollup}`);
hard(full.verdict.total_runs === MAX,
     `the record reached the contract's limit of ${MAX} runs`);
hard(full.verdict.standing_run === MAX,
     "the standing verdict is the last run, not the first");

// ── 1. the app refuses the run that would exceed the cap ────────────────────
const extra = await upload(seller, a.id, {
  filename: "one-more.txt",
  text: "FURTHER NOTE 2026-05-20. VIN 1HGCM82633A004352. The seller wishes " +
        "the record reconsidered once more.",
  declaredClass: "SELLER_DECLARATION",
  declaredLabel: "A fourth appeal's evidence",
  captureDate: "2026-05-20",
});
const refused = await seller.raw(`/api/assessments/${a.id}/appeal`, {
  method: "POST",
  body: JSON.stringify({ grounds: "One more look, please.", newEvidenceIds: [extra.id] }),
});
const refusedBody = await refused.json().catch(() => null);
log(`fifth run through the app: ${refused.status} — ${refusedBody?.message ?? ""}`);
hard(refused.status === 409,
     "the app refuses a run past the cap instead of filing a doomed job");
hard(new RegExp(String(MAX)).test(refusedBody?.message ?? ""),
     "the refusal quotes the contract's own number, not a remembered one");

const afterRefusal = await seller.api(`/api/assessments/${a.id}`);
hard(!afterRefusal.evidenceItems.find((i) => i.id === extra.id)?.onChainTxHash,
     "the refused appeal's evidence was never written to the chain");
hard((await seller.api(`/api/assessments/${a.id}/jobs`)).jobs
       .every((j) => j.state === "DONE"),
     "the refusal left no job behind to fail later");

// ── 2. and the contract refuses for itself ──────────────────────────────────
// The app is not the only caller. This goes straight at the contract with
// an operator key, the way anything holding a key could.
const chain = { ...studioDevnet, name: "GenLayer Studio Next", rpcUrls: { default: { http: [RPC] } } };
const KEYS = JSON.parse(readFileSync(new URL("../.data/keys.json", import.meta.url), "utf-8"));
const client = createClient({ chain, account: createAccount(KEYS.OPERATOR.pk) });
const FEE_FLOOR = 10n ** 15n;

log(`calling readjudicate directly on ${CONTRACT} for ${afterFirst.onChainId}`);
const est = await client.estimateTransactionFees();
const hash = await client.writeContract({
  address: CONTRACT,
  functionName: "readjudicate",
  args: [afterFirst.onChainId, KEYS.OPERATOR.addr, "direct call past the cap"],
  value: 0n,
  fees: {
    distribution: est.distribution,
    feeValue: est.feeValue > FEE_FLOOR ? est.feeValue : FEE_FLOOR,
  },
});
log(`direct tx ${hash}`);

// Decoding a refusal is the product's own job, and it already knows the
// shape this network uses — `result` IS the base64 string here, not
// `result.payload`. A second decoder written from scratch got that
// wrong and reported an empty refusal, so this asks the client.
const status = await new AutoCourtChain({
  rpcUrl: RPC,
  contractAddress: CONTRACT,
  privateKey: KEYS.OPERATOR.pk,
}).waitFinality(hash);
const refusal = status.refusalText ?? "";
log(`direct call: ${status.status} · ${status.leaderResult} · ${refusal}`);

hard(status.leaderResult === "ERROR",
     "the contract itself refuses a run past the cap, to a key calling it directly");
hard(/at most/i.test(refusal) && new RegExp(String(MAX)).test(refusal),
     "and it says why, in its own words, quoting its own limit");

console.log("\n============== RUNS CAP ==============");
console.log(`${afterFirst.onChainId}: ${full.verdict.total_runs}/${MAX} runs, standing run ${full.verdict.standing_run}`);
console.log(`app      → ${refused.status} ${refusedBody?.message ?? ""}`);
console.log(`contract → ${status.leaderResult} ${refusal}`);
console.log(`           tx ${hash}`);
console.log(failures.length === 0
  ? "RUNS CAP PROVEN LIVE — refused at the app, and refused by the contract itself."
  : `INCOMPLETE — ${failures.length}: ${failures.join("; ")}`);
console.log("======================================");
process.exit(failures.length === 0 ? 0 : 1);
