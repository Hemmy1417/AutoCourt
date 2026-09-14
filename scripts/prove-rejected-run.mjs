/**
 * A REJECTED run, honestly produced.
 *
 *   node scripts/prove-rejected-run.mjs      (server + dev-db + worker up)
 *
 * REJECTED is a status the CHAIN can never write. The contract records
 * only judgments that survived consensus, so an adjudication the chain
 * refused exists only as an app-side row: the attempt, its refusal
 * sentence, and its transaction hash, kept rather than dropped.
 *
 * That path had never run. The temptation is to force it by writing the
 * row or poisoning a job, which would prove nothing — a status I typed
 * in myself is not evidence that the product records refusals.
 *
 * So this uses a refusal the contract issues on its own, from something
 * users genuinely do: asking for adjudication twice at once. A double
 * click, or two open tabs. Both requests see a submitted packet, both
 * are accepted, and both reach the chain. The first is judged. The
 * second is refused in the contract's own words — a packet that has not
 * changed cannot be judged twice; a re-judgment is an appeal.
 *
 * What must then be true: exactly one SUCCESS run, one REJECTED run
 * carrying the contract's sentence and its own transaction hash, and a
 * standing verdict the refused duplicate did not disturb.
 */
import { Actor, asserter, logger, settled, upload } from "./lib/harness.mjs";

const log = logger("rejected");
const { hard, failures } = asserter(log);
// The subject of this proof IS a failed job, so a FAILED job must not
// abort the wait — that is the thing being looked for.
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
// Not contrived: this is a double click, or two open tabs. Both requests
// read a submitted packet before either writes PROCESSING.
const [first, second] = await Promise.all([
  seller.raw(`/api/assessments/${a.id}/adjudicate`, { method: "POST" }),
  seller.raw(`/api/assessments/${a.id}/adjudicate`, { method: "POST" }),
]);
const accepted = [first, second].filter((r) => r.ok).length;
log(`two simultaneous adjudication requests: ${first.status} and ${second.status} — ${accepted} accepted`);

if (accepted < 2) {
  // Also a legitimate outcome, and worth saying plainly rather than
  // reaching for the other one.
  console.log("\n============ REJECTED RUN ============");
  console.log(`The app serialised the duplicate itself (${first.status}/${second.status}), so the ` +
              `contract was never asked twice and no REJECTED run could arise from this path.`);
  console.log("NOT PROVEN — and not manufactured either. The refusal path stays unproven.");
  console.log("======================================");
  process.exit(2);
}

const done = await wait(seller, a.id, "both attempts");
const runs = done.runs ?? [];
for (const r of runs)
  log(`run row: ${r.status} · kind ${r.kind} · run ${r.runNumber} · ` +
      `tx ${(r.txHash ?? "—").slice(0, 14)} · ${(r.errorText ?? "").slice(0, 90)}`);

const success = runs.filter((r) => r.status === "SUCCESS");
const rejected = runs.filter((r) => r.status === "REJECTED");

hard(success.length === 1,
     "the packet was judged exactly once, however many times it was asked");
hard(rejected.length === 1,
     "the refused duplicate is kept on the record as a REJECTED run");
hard(Boolean(rejected[0]?.txHash),
     "the refused attempt keeps its own transaction hash — it is checkable on chain");
hard(/already judged|at most|EXPECTED/i.test(rejected[0]?.errorText ?? ""),
     "the record carries the contract's own refusal sentence, not a paraphrase");
hard(rejected[0]?.runNumber === 0,
     "a refused attempt takes no run number — it never became a run");

const verdict = await seller.api(`/api/assessments/${a.id}/verdict`).catch(() => null);
hard(verdict?.verdict?.total_runs === 1,
     "the chain still holds exactly one run: the refusal changed nothing on it");

console.log("\n============ REJECTED RUN ============");
console.log(`${done.onChainId}: ${success.length} SUCCESS + ${rejected.length} REJECTED · state ${done.state}`);
console.log(`refusal: ${(rejected[0]?.errorText ?? "").slice(0, 150)}`);
console.log(`tx:      ${rejected[0]?.txHash ?? "—"}`);
console.log(failures.length === 0
  ? "REJECTED RUN PROVEN — a refusal the contract issued, recorded rather than dropped."
  : `INCOMPLETE — ${failures.length}: ${failures.join("; ")}`);
console.log("======================================");
process.exit(failures.length === 0 ? 0 : 1);
