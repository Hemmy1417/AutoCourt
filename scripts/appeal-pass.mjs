/**
 * The appeal path, THROUGH THE APP.
 *
 *   node scripts/appeal-pass.mjs        (server + dev-db + dev-drain up)
 *
 * scripts/arc.mjs proves readjudication against the contract directly.
 * This proves the half a user actually touches: the /appeal route, the
 * SUBMIT_APPEAL_EVIDENCE and READJUDICATE jobs, and the RE_ADJUDICATION
 * branch of recordJobEffects — which had never executed once.
 *
 * A full cycle: seller lists and submits, the panel rules, THEN the buyer
 * adds a post-verdict counter-report and appeals in their own name. The
 * asserts are the things that would silently rot: run 2 exists and is a
 * RE_ADJUDICATION, the Appeal row is linked to it rather than orphaned at
 * runNumber null, run 1 is byte-identical afterwards, and the standing
 * verdict names 2 of 2.
 */
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const BASE = process.env.AUTOCOURT_URL ?? "http://localhost:3108";
const log = (s) => console.log(`[appeal ${new Date().toISOString().slice(11, 19)}] ${s}`);
const failures = [];
const hard = (cond, what) => {
  if (cond) log(`ASSERT ok — ${what}`);
  else { log(`ASSERT FAILED — ${what}`); failures.push(what); }
};

class Actor {
  constructor(name) {
    this.name = name;
    this.account = privateKeyToAccount(generatePrivateKey());
    this.cookie = "";
  }
  async api(path, init = {}) {
    const res = await fetch(BASE + path, {
      ...init,
      headers: {
        ...(init.body && !(init.body instanceof FormData)
          ? { "content-type": "application/json" } : {}),
        cookie: this.cookie, ...(init.headers ?? {}),
      },
    });
    const sc = res.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(";")[0];
    const body = await res.json().catch(() => null);
    if (!res.ok)
      throw new Error(`${this.name} ${path}: ${res.status} ${JSON.stringify(body).slice(0, 220)}`);
    return body;
  }
  async signIn() {
    const { nonce, message } = await this.api("/api/auth/nonce", {
      method: "POST", body: JSON.stringify({ address: this.account.address }),
    });
    const signature = await this.account.signMessage({ message });
    await this.api("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ address: this.account.address, nonce, signature, displayName: this.name }),
    });
    log(`${this.name} signed in (${this.account.address.slice(0, 10)}…)`);
  }
}

async function upload(actor, id, filename, text, cls, label, date) {
  const form = new FormData();
  form.set("file", new Blob([text], { type: "text/plain" }), filename);
  form.set("declaredClass", cls);
  form.set("declaredLabel", label);
  form.set("captureDate", date);
  return actor.api(`/api/assessments/${id}/evidence`, { method: "POST", body: form });
}
const consent = (actor, id, itemId) =>
  actor.api(`/api/assessments/${id}/evidence/${itemId}/consent`, {
    method: "POST", body: JSON.stringify({ consentVersion: "publicity-statement-1" }),
  });

/** Wait until every queued job is DONE, failing loudly if any job fails. */
async function drained(actor, id, label, minutes = 20) {
  const deadline = Date.now() + minutes * 60_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`${label}: not drained in ${minutes} minutes`);
    await new Promise((r) => setTimeout(r, 12_000));
    const { jobs } = await actor.api(`/api/assessments/${id}/jobs`);
    const failed = jobs.filter((j) => j.state === "FAILED");
    if (failed.length)
      throw new Error(`${label}: ${failed.map((j) => `${j.kind}: ${j.lastError}`).join("; ")}`);
    const pending = jobs.filter((j) => j.state !== "DONE");
    const d = await actor.api(`/api/assessments/${id}`);
    log(`${label}: state ${d.state} · on-chain ${d.onChainId ?? "—"} · pending ${pending.length}${pending.length ? ` (${pending.map((j) => j.kind).join(", ")})` : ""}`);
    if (pending.length === 0) return d;
  }
}

const seller = new Actor("Appeal Seller");
const buyer = new Actor("Appeal Buyer");
await seller.signIn();
await buyer.signIn();

// ── a record, submitted and ruled on ────────────────────────────────────────
const vehicle = await seller.api("/api/vehicles", {
  method: "POST",
  body: JSON.stringify({
    vin: "1HGCM82633A004352", make: "Honda", model: "Accord", year: 2003,
    claims: [
      { type: "MILEAGE", declaredValue: "87,432 miles" },
      { type: "ACCIDENT_HISTORY", declaredValue: "no recorded accidents" },
    ],
  }),
});
const a = await seller.api("/api/assessments", {
  method: "POST", body: JSON.stringify({ vehicleId: vehicle.id }),
});
log(`assessment ${a.id}`);

const invoice = await upload(seller, a.id, "invoice.txt",
  "MAIN DEALER SERVICE INVOICE 2026-03-07. VIN 1HGCM82633A004352. " +
  "Odometer reading 87,432 miles at service. Brake pads and rotors replaced.",
  "SERVICE_INVOICE", "March invoice", "2026-03-07");
await seller.api(`/api/assessments/${a.id}/evidence/${invoice.id}/observations`, {
  method: "POST",
  body: JSON.stringify({ rows: [{ docDate: "2026-03-07", odometerReading: 87432, odometerUnit: "MILES", sourceField: "odometer line" }] }),
});
await consent(seller, a.id, invoice.id);

const link = await seller.api(`/api/assessments/${a.id}/share`, {
  method: "POST", body: JSON.stringify({ expiresInDays: 7 }),
});
await buyer.api(`/api/share/${link.token}`, { method: "POST" });
const detail = await buyer.api(`/api/assessments/${a.id}`);
const accident = detail.vehicle.claims.find((c) => c.type === "ACCIDENT_HISTORY");
await buyer.api(`/api/assessments/${a.id}/disputes`, {
  method: "POST",
  body: JSON.stringify({ claimRowIds: [accident.id], note: "front wing looks resprayed" }),
});
const history = await upload(buyer, a.id, "history.txt",
  "VEHICLE HISTORY RECORD pulled 2026-01-15. VIN 1HGCM82633A004352. " +
  "No total-loss markers. Odometer 86,900 miles at MOT. One bodyshop entry 2024-08.",
  "VEHICLE_HISTORY_RECORD", "History pull", "2026-01-15");
await consent(buyer, a.id, history.id);

await seller.api(`/api/assessments/${a.id}/submit`, { method: "POST" });
log("submitted — waiting for the record to reach the chain");
await drained(seller, a.id, "submit");

await seller.api(`/api/assessments/${a.id}/adjudicate`, { method: "POST" });
log("adjudication requested");
await drained(seller, a.id, "run 1", 25);
const v1 = await seller.api(`/api/assessments/${a.id}/verdict`);
log(`run 1 standing: ${v1.verdict.standing_run}/${v1.verdict.total_runs} · ${v1.verdict.rollup}`);
hard(v1.verdict.standing_run === 1 && v1.verdict.total_runs === 1, "run 1 is the standing verdict");
const run1Before = JSON.stringify(
  (await seller.api(`/api/assessments/${a.id}/runs/1`)).run);

// ── the appeal, filed by the buyer in their own name ────────────────────────
const counter = await upload(buyer, a.id, "counter.txt",
  "INDEPENDENT INSPECTION 2026-06-10. VIN 1HGCM82633A004352. Frame rail " +
  "shows repair consistent with a prior collision. No repair invoices on file.",
  "MECHANIC_REPORT", "Post-verdict counter-report", "2026-06-10");
await consent(buyer, a.id, counter.id);
log(`post-verdict counter-report uploaded as ${counter.evidenceId}`);

const appeal = await buyer.api(`/api/assessments/${a.id}/appeal`, {
  method: "POST",
  body: JSON.stringify({
    grounds: "An independent inspection after the verdict found frame repair the history pull did not show.",
    newEvidenceIds: [counter.id],
  }),
});
log(`appeal filed (${appeal.appeal.id}) — waiting for readjudication`);
await drained(buyer, a.id, "appeal", 25);

// ── what must be true afterwards ────────────────────────────────────────────
const v2 = await seller.api(`/api/assessments/${a.id}/verdict`);
log(`after appeal: standing ${v2.verdict.standing_run}/${v2.verdict.total_runs} · ${v2.verdict.rollup}`);
hard(v2.verdict.total_runs === 2, "the appeal produced a second run on chain");
hard(v2.verdict.standing_run === 2, "the standing verdict is the appeal's run");

const attempts = v2.attempts ?? [];
const reAdj = attempts.find((r) => r.kind === "RE_ADJUDICATION");
hard(Boolean(reAdj), "the app recorded the run as a RE_ADJUDICATION");
hard(Boolean(reAdj?.txHash), "the readjudication kept its transaction hash");
hard(reAdj?.runNumber === 2, "the recorded run number matches the chain");

const after = await seller.api(`/api/assessments/${a.id}`);
hard(after.state === "ADJUDICATED", "the assessment returned to ADJUDICATED");

// The prior run must be untouched — an appeal adds a run, it never edits
// one. Read from the chain through the app, before and after.
const run1After = JSON.stringify(
  (await seller.api(`/api/assessments/${a.id}/runs/1`)).run);
hard(run1After === run1Before,
     "run 1 is byte-identical after the appeal (the record is immutable)");

// The never-executed branch: recordJobEffects must link the Appeal row to
// the run it produced instead of leaving it orphaned at runNumber null.
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
try {
  const row = await prisma.appeal.findUnique({ where: { id: appeal.appeal.id } });
  hard(row?.runNumber === 2,
       "the Appeal row is linked to run 2 rather than orphaned at null");
  hard(Boolean(row?.txHash), "the Appeal row kept the readjudication tx hash");
} finally {
  await prisma.$disconnect();
}

console.log("\n============== APPEAL PASS ==============");
console.log(`assessment ${after.onChainId} · runs ${v2.verdict.total_runs}`);
for (const c of v2.verdict.claims ?? [])
  console.log(`  ${c.claim_id} ${c.claim_type}: ${c.verdict} · ${c.confidence}`);

console.log(failures.length === 0
  ? "APPEAL PASS COMPLETE — the appeal path works through the product."
  : `APPEAL PASS FAILED — ${failures.length}: ${failures.join("; ")}`);
console.log("=========================================");
process.exit(failures.length === 0 ? 0 : 1);
