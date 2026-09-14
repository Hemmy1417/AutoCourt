/**
 * Every action a party can take twice at once, taken twice at once.
 *
 *   node scripts/prove-double-clicks.mjs     (server + dev-db + worker up)
 *
 * HOW THIS STARTED. REJECTED is a status the chain can never write, so an
 * adjudication the contract refused exists only as an app-side row. That
 * path had never run, and writing the row by hand would have proven
 * nothing, so it was reached through something users genuinely do: asking
 * for adjudication twice at once. On ac-000019 both requests were
 * accepted, both reached the chain, and the contract refused the second
 * in its own words —
 *
 *   run 1 already judged this exact packet; a re-judgment is an appeal
 *   tx 0x7a57a3ffde076b175622bbf9259633a4960897de536ca83462db27f4960579a4
 *
 * — so the refusal path is proven by that record, still on chain.
 *
 * WHAT IT FOUND WAS WIDER. Every route that moves a record checked its
 * state and then wrote it, in two steps, and a double click passes both.
 * Adjudicate was fixed first; the same shape was then found in submit
 * (two whole job chains), appeal (a second run spent from the few the
 * contract allows), anchor (the record put on chain twice), and disputes
 * (the same stake recorded twice). They now share two primitives: a claim
 * that only one request can win, and a record lock for additive writes.
 *
 * This drives ONE record through all five, each as two simultaneous
 * requests, and asserts the same three things every time: one accepted,
 * one refused in words, and exactly one piece of work queued.
 */
import { Actor, asserter, logger, settled, upload } from "./lib/harness.mjs";

const ANCHOR =
  "https://raw.githubusercontent.com/Hemmy1417/InsureShield/e59e528650" +
  "/fixtures/evidence/adversarial/incident_report_delivery.txt";

const log = logger("twice");
const { hard, failures } = asserter(log);
const wait = (actor, id, label) => settled(actor, id, label, { log });

/** Fire the same request twice in the same instant. */
async function twice(actor, path, body) {
  const send = () =>
    actor.raw(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
  const responses = await Promise.all([send(), send()]);
  const bodies = await Promise.all(responses.map((r) => r.json().catch(() => null)));
  const codes = responses.map((r) => r.status);
  const refusal = bodies[codes.findIndex((c) => c === 409)]?.message ?? "";
  return { codes, accepted: responses.filter((r) => r.ok).length, refusal };
}

const count = async (actor, id, kind) =>
  (await actor.api(`/api/assessments/${id}/jobs`)).jobs.filter((j) => j.kind === kind).length;

function oneWon(what, result) {
  log(`${what} ×2 → ${result.codes.join(" and ")}${result.refusal ? ` · "${result.refusal}"` : ""}`);
  hard(result.accepted === 1, `${what}: exactly one of two simultaneous requests is accepted`);
  hard(result.codes.includes(409) && result.refusal.length > 0,
       `${what}: the other is refused with a 409 that says why`);
}

const seller = await new Actor("Twice Seller").signIn();
const buyer = await new Actor("Twice Buyer").signIn();

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

// ── 1. anchor: one source, and the record created on chain once ────────────
const anchor = await twice(seller, `/api/assessments/${a.id}/anchor`, {
  url: ANCHOR, declaredLabel: "Collision report",
});
oneWon("add an independent source", anchor);
hard(await count(seller, a.id, "CREATE") === 1,
     "add an independent source: the record is created on chain once, not twice");
hard(await count(seller, a.id, "SUBMIT_ANCHOR") === 1,
     "add an independent source: the source is written once");

await upload(seller, a.id, {
  filename: "service.txt",
  text: "SERVICE HISTORY 2026-03-11. VIN 1HGCM82633A004352, Honda Accord. " +
        "Annual service completed at 61,204 miles. Oil, filters, brake fluid. " +
        "Previous service recorded at 49,880 miles.",
  declaredClass: "SERVICE_INVOICE",
  declaredLabel: "Annual service record",
  captureDate: "2026-03-11",
});

// ── 2. dispute: one stake, carried into the submission once ────────────────
const link = await seller.api(`/api/assessments/${a.id}/share`, {
  method: "POST", body: JSON.stringify({ expiresInDays: 1 }),
});
await buyer.api(`/api/share/${link.token}`, { method: "POST" });
const claimRow = (await buyer.api(`/api/assessments/${a.id}`)).vehicle.claims[0];
const dispute = await twice(buyer, `/api/assessments/${a.id}/disputes`, {
  claimRowIds: [claimRow.id], note: "no invoices before 2025",
});
oneWon("dispute a claim", dispute);
const disputes = (await buyer.api(`/api/assessments/${a.id}`)).vehicle.claims[0].disputes;
hard(disputes.length === 1, "dispute a claim: the stake is stored once");
hard(await count(seller, a.id, "RECORD_DISPUTE") === 0,
     "dispute a claim: a draft carries it into the submission instead of writing it now");

await wait(seller, a.id, "source entering");

// ── 3. submit: one job chain ───────────────────────────────────────────────
oneWon("submit", await twice(seller, `/api/assessments/${a.id}/submit`));
hard(await count(seller, a.id, "SEAL") === 1, "submit: one seal is queued");
hard(await count(seller, a.id, "SUBMIT_EVIDENCE") === 1, "submit: each item is written once");
hard(await count(seller, a.id, "RECORD_DISPUTE") === 1,
     "submit: the buyer's dispute reaches the chain exactly once");
await wait(seller, a.id, "submission");

// ── 4. adjudicate: one panel ───────────────────────────────────────────────
oneWon("adjudicate", await twice(seller, `/api/assessments/${a.id}/adjudicate`));
hard(await count(seller, a.id, "ADJUDICATE") === 1,
     "adjudicate: one adjudication is queued, so one transaction is spent");
const judged = await wait(seller, a.id, "adjudication");
const runs1 = judged.runs ?? [];
hard(runs1.filter((r) => r.status === "SUCCESS").length === 1, "adjudicate: the packet is judged once");
hard(runs1.filter((r) => r.status !== "SUCCESS").length === 0,
     "adjudicate: no refused attempt is recorded, because none was sent");
hard(judged.state === "ADJUDICATED", "adjudicate: the record carries its verdict and stays appealable");

// ── 5. appeal: one run spent ───────────────────────────────────────────────
const fresh = await upload(seller, a.id, {
  filename: "later-service.txt",
  text: "SERVICE INVOICE 2026-06-02. VIN 1HGCM82633A004352. Interim service at " +
        "66,410 miles, invoice 5521, stamped by the dealer.",
  declaredClass: "SERVICE_INVOICE",
  declaredLabel: "Interim service invoice",
  captureDate: "2026-06-02",
});
oneWon("appeal", await twice(seller, `/api/assessments/${a.id}/appeal`, {
  grounds: "A later dealer invoice was not in the packet.",
  newEvidenceIds: [fresh.id],
}));
hard(await count(seller, a.id, "READJUDICATE") === 1,
     "appeal: one re-adjudication is queued, so one run is spent");
hard(await count(seller, a.id, "SUBMIT_APPEAL_EVIDENCE") === 1,
     "appeal: its new evidence is written once");
const appealed = await wait(seller, a.id, "appeal");
hard((appealed.runs ?? []).filter((r) => r.status === "SUCCESS").length === 2,
     "appeal: the record holds exactly two runs — the verdict and one appeal");

console.log("\n=========== EVERYTHING, TWICE AT ONCE ===========");
console.log(`${appealed.onChainId}: source · dispute · submit · adjudicate · appeal`);
console.log(`the refusal path itself: ac-000019, REJECTED in the contract's own words`);
console.log(failures.length === 0
  ? "DEFENDED — no action taken twice at once reaches the chain twice."
  : `INCOMPLETE — ${failures.length}: ${failures.join("; ")}`);
console.log("=================================================");
process.exit(failures.length === 0 ? 0 : 1);
