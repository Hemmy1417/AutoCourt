/**
 * Two adjudications at once: what it used to cost, and what it costs now.
 *
 *   node scripts/prove-rejected-run.mjs      (server + dev-db + worker up)
 *
 * REJECTED is a status the CHAIN can never write. The contract records
 * only judgments that survived consensus, so an adjudication the chain
 * refused exists only as an app-side row: the attempt, its refusal
 * sentence, and its transaction hash, kept rather than dropped.
 *
 * That path had never run. Forcing it by writing the row would have
 * proven nothing — a status typed in by hand is not evidence that the
 * product records refusals — so it was reached instead through something
 * users genuinely do: asking for adjudication twice at once. A double
 * click, or two open tabs.
 *
 * IT WORKED, AND IT SHOWED TWO DEFECTS.
 *
 * On ac-000019 both requests were accepted (200 and 200), both reached
 * the chain, and the contract refused the second in its own words:
 *
 *   run 1 already judged this exact packet; a re-judgment is an appeal
 *   tx 0x7a57a3ffde076b175622bbf9259633a4960897de536ca83462db27f4960579a4
 *   (the judged one: 0x91fd889fc6…, run 1, SUCCESS)
 *
 * So the REJECTED row is real, carries the contract's sentence and its
 * own hash, and takes no run number. The verdict was untouched. But:
 *
 *   1. it cost a real transaction and a real fee to learn nothing, and
 *   2. recording the refusal set the record's state to FAILED
 *      unconditionally. It ended ADJUDICATED only because the effects
 *      pass happened to see the failed job before the successful one —
 *      an unordered query. The other order leaves a record reading
 *      FAILED with a good verdict standing, and since an appeal needs a
 *      standing verdict, that locks both parties out of appealing.
 *
 * Both are fixed. The route now CLAIMS the record with a conditional
 * update before queueing, so only one request can win; and recording a
 * refusal never overwrites a state that has a successful run behind it.
 *
 * What this script proves today is the defence: two simultaneous
 * requests, one accepted, one refused by the app, and exactly one
 * transaction spent. The refusal path itself stays proven by ac-000019
 * above — recorded before the defence existed, and still on chain.
 */
import { Actor, asserter, logger, settled, upload } from "./lib/harness.mjs";

const log = logger("rejected");
const { hard, failures } = asserter(log);
const wait = (actor, id, label) =>
  settled(actor, id, label, { log, failOnJobFailure: false });

const seller = await new Actor("Rejected Seller").signIn();
const vehicle = await seller.api("/api/vehicles", {
  method: "POST",
  body: JSON.stringify({
    vin: "1HGCM82633A004352", make: "Honda", model: "Accord", year: 2003,
    claims: [{ type: "SERVICE_HISTORY", declaredValue: "serviced annually, full history" }],
  }),
});
const a = await seller.api("/api/assessments", {
  method: "POST", body: JSON.stringify({ vehicleId: vehicle.id }),
});
log(`record ${a.id}`);

await upload(seller, a.id, {
  filename: "service.txt",
  text: "SERVICE HISTORY 2026-03-11. VIN 1HGCM82633A004352, Honda Accord. " +
        "Annual service completed at 61,204 miles. Oil, filters, brake fluid. " +
        "Previous service recorded at 49,880 miles.",
  declaredClass: "SERVICE_INVOICE",
  declaredLabel: "Annual service record",
  captureDate: "2026-03-11",
});
await seller.api(`/api/assessments/${a.id}/submit`, { method: "POST" });
await wait(seller, a.id, "submit");

// ── ask twice, at the same instant ──────────────────────────────────────────
const [first, second] = await Promise.all([
  seller.raw(`/api/assessments/${a.id}/adjudicate`, { method: "POST" }),
  seller.raw(`/api/assessments/${a.id}/adjudicate`, { method: "POST" }),
]);
const codes = [first.status, second.status];
const accepted = [first, second].filter((r) => r.ok).length;
log(`two simultaneous adjudication requests: ${codes.join(" and ")} — ${accepted} accepted`);

hard(accepted === 1,
     "exactly one of two simultaneous adjudication requests is accepted");
hard(codes.includes(409),
     "the loser is told an adjudication is already in flight, in words");

const jobs = (await seller.api(`/api/assessments/${a.id}/jobs`)).jobs
  .filter((j) => j.kind === "ADJUDICATE");
hard(jobs.length === 1,
     "only one adjudication was queued, so only one transaction is ever spent");

const done = await wait(seller, a.id, "adjudication");
const runs = done.runs ?? [];
for (const r of runs)
  log(`run row: ${r.status} · kind ${r.kind} · run ${r.runNumber} · tx ${(r.txHash ?? "—").slice(0, 14)}`);

hard(runs.filter((r) => r.status === "SUCCESS").length === 1,
     "the packet was judged exactly once");
hard(runs.filter((r) => r.status === "REJECTED").length === 0,
     "no wasted refusal was recorded, because none was ever sent");
hard(done.state === "ADJUDICATED",
     "the record carries its verdict and stays appealable");

console.log("\n======== SIMULTANEOUS ADJUDICATION ========");
console.log(`${done.onChainId}: ${codes.join("/")} · ${jobs.length} job · state ${done.state}`);
console.log(`the refusal path itself: ac-000019, REJECTED with the contract's own sentence,`);
console.log(`tx 0x7a57a3ffde076b175622bbf9259633a4960897de536ca83462db27f4960579a4`);
console.log(failures.length === 0
  ? "DEFENDED — a double click no longer reaches the chain, and a refusal cannot bury a verdict."
  : `INCOMPLETE — ${failures.length}: ${failures.join("; ")}`);
console.log("===========================================");
process.exit(failures.length === 0 ? 0 : 1);
