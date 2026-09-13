/**
 * Demo seed: a realistic, fully-adjudicated record to look at, built
 * through the SAME API the browser drives — no direct database writes,
 * so what you see on screen is what the product actually produces.
 *
 *   node scripts/seed-demo.mjs        (server + dev-db + dev-drain up)
 *
 * The wallets are FIXED (dev-only keys, below) so scripts/dev-signer.mjs
 * can sign in as the same seller in the browser pane. Never used for
 * anything but local demos; they hold nothing.
 */
import { privateKeyToAccount } from "viem/accounts";

import { SELLER_PK, BUYER_PK } from "./demo-keys.mjs";

const BASE = process.env.AUTOCOURT_URL ?? "http://localhost:3108";
const log = (s) => console.log(`[seed ${new Date().toISOString().slice(11, 19)}] ${s}`);

class Actor {
  constructor(name, pk) {
    this.name = name;
    this.account = privateKeyToAccount(pk);
    this.cookie = "";
  }

  async api(path, init = {}) {
    const res = await fetch(BASE + path, {
      ...init,
      headers: {
        ...(init.body && !(init.body instanceof FormData)
          ? { "content-type": "application/json" }
          : {}),
        cookie: this.cookie,
        ...(init.headers ?? {}),
      },
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const body = await res.json().catch(() => null);
    if (!res.ok)
      throw new Error(`${this.name} ${path}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
    return body;
  }

  async signIn() {
    const { nonce, message } = await this.api("/api/auth/nonce", {
      method: "POST",
      body: JSON.stringify({ address: this.account.address }),
    });
    const signature = await this.account.signMessage({ message });
    await this.api("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({
        address: this.account.address,
        nonce,
        signature,
        displayName: this.name,
      }),
    });
    log(`${this.name} signed in (${this.account.address.slice(0, 10)}…)`);
  }
}

async function upload(actor, id, filename, text, cls, label, captureDate) {
  const form = new FormData();
  form.set("file", new Blob([text], { type: "text/plain" }), filename);
  form.set("declaredClass", cls);
  form.set("declaredLabel", label);
  form.set("captureDate", captureDate);
  return actor.api(`/api/assessments/${id}/evidence`, { method: "POST", body: form });
}

const consent = (actor, id, itemId) =>
  actor.api(`/api/assessments/${id}/evidence/${itemId}/consent`, {
    method: "POST",
    body: JSON.stringify({ consentVersion: "publicity-statement-1" }),
  });

const seller = new Actor("Sade Okonjo", SELLER_PK);
const buyer = new Actor("Bode Adeyemi", BUYER_PK);
await seller.signIn();
await buyer.signIn();

const vehicle = await seller.api("/api/vehicles", {
  method: "POST",
  body: JSON.stringify({
    vin: "1M8GDM9AXKP042788",
    make: "Meridian",
    model: "GT Wagon",
    year: 2019,
    claims: [
      { type: "MILEAGE", declaredValue: "87,432 miles" },
      { type: "ACCIDENT_HISTORY", declaredValue: "no recorded accidents" },
      { type: "SERVICE_HISTORY", declaredValue: "full history, main dealer" },
    ],
  }),
});
const a = await seller.api("/api/assessments", {
  method: "POST",
  body: JSON.stringify({ vehicleId: vehicle.id }),
});
log(`assessment ${a.id} opened on ${vehicle.year} ${vehicle.make} ${vehicle.model}`);

const invoice = await upload(
  seller, a.id, "march-service-invoice.txt",
  "MERIDIAN MAIN DEALER — SERVICE INVOICE 2026-03-07\n" +
  "Vehicle: 2019 Meridian GT Wagon. VIN 1M8GDM9AXKP042788.\n" +
  "Odometer reading 87,432 miles at service.\n" +
  "Work carried out: replaced front brake pads and rotors; oil and filter " +
  "change; cabin filter. Scheduled maintenance up to date.\n" +
  "Next service due at 92,000 miles. Paid by card ending 4417.",
  "SERVICE_INVOICE", "March main-dealer invoice", "2026-03-07",
);
await seller.api(`/api/assessments/${a.id}/evidence/${invoice.id}/observations`, {
  method: "POST",
  body: JSON.stringify({
    rows: [{ docDate: "2026-03-07", odometerReading: 87432,
             odometerUnit: "MILES", sourceField: "odometer line" }],
  }),
});
await consent(seller, a.id, invoice.id);
log("seller: invoice uploaded, typed row saved, consented");

const link = await seller.api(`/api/assessments/${a.id}/share`, {
  method: "POST",
  body: JSON.stringify({ expiresInDays: 30 }),
});
await buyer.api(`/api/share/${link.token}`, { method: "POST" });
const detail = await buyer.api(`/api/assessments/${a.id}`);
const accident = detail.vehicle.claims.find((c) => c.type === "ACCIDENT_HISTORY");
await buyer.api(`/api/assessments/${a.id}/disputes`, {
  method: "POST",
  body: JSON.stringify({
    claimRowIds: [accident.id],
    note: "listing photos show a repainted front wing",
  }),
});
const history = await upload(
  buyer, a.id, "history-pull.txt",
  "VEHICLE HISTORY RECORD — pulled 2026-01-15\n" +
  "VIN 1M8GDM9AXKP042788. Two previous keepers.\n" +
  "No insurance total-loss markers found. No outstanding finance.\n" +
  "Odometer reported 86,900 miles on 2026-01-15 at MOT.\n" +
  "One bodyshop entry 2024-08: front nearside wing refinished.",
  "VEHICLE_HISTORY_RECORD", "History pull", "2026-01-15",
);
await buyer.api(`/api/assessments/${a.id}/evidence/${history.id}/observations`, {
  method: "POST",
  body: JSON.stringify({
    rows: [{ docDate: "2026-01-15", odometerReading: 86900,
             odometerUnit: "MILES", sourceField: "MOT odometer" }],
  }),
});
await consent(buyer, a.id, history.id);
log("buyer: redeemed the link, disputed the accident claim, countered with a history pull");

const submitted = await seller.api(`/api/assessments/${a.id}/submit`, { method: "POST" });
log(`submitted — manifest root ${submitted.manifestRoot.slice(0, 16)}…`);

// Watch the drain carry it to the chain, then ask for the panel round.
const DEADLINE = Date.now() + 20 * 60_000;
let adjudicateRequested = false;
for (;;) {
  if (Date.now() > DEADLINE) {
    console.error("SEED INCOMPLETE — the pipeline did not finish in 20 minutes");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 12_000));
  const d = await seller.api(`/api/assessments/${a.id}`);
  const { jobs } = await seller.api(`/api/assessments/${a.id}/jobs`);
  const failed = jobs.filter((j) => j.state === "FAILED");
  if (failed.length) {
    console.error(`SEED FAILED — ${failed.map((j) => `${j.kind}: ${j.lastError}`).join("; ")}`);
    process.exit(1);
  }
  const pending = jobs.filter((j) => j.state !== "DONE");
  log(`state ${d.state} · on-chain ${d.onChainId ?? "—"} · pending ${pending.length}${pending.length ? ` (${pending.map((j) => j.kind).join(", ")})` : ""}`);

  if (d.onChainId && pending.length === 0 && !adjudicateRequested) {
    await seller.api(`/api/assessments/${a.id}/adjudicate`, { method: "POST" });
    adjudicateRequested = true;
    log("adjudication requested — the panel round takes about a minute");
    continue;
  }
  if (adjudicateRequested && d.state === "ADJUDICATED") {
    const v = await seller.api(`/api/assessments/${a.id}/verdict`);
    console.log("\n================ DEMO RECORD READY ================");
    console.log(`app assessment ${a.id} → on-chain ${d.onChainId}`);
    console.log(`standing run ${v.verdict.standing_run} of ${v.verdict.total_runs} · rollup ${v.verdict.rollup}`);
    for (const c of v.verdict.claims ?? [])
      console.log(`  ${c.claim_id} ${c.claim_type}: ${c.verdict} · confidence ${c.confidence}`);
    console.log(`seller wallet ${seller.account.address}`);
    console.log(`share path /share/${link.token}`);
    console.log("===================================================");
    process.exit(0);
  }
}
