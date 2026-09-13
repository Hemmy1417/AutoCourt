/**
 * The seam pass: proves the app→chain pipeline end to end on the RUNNING
 * local stack — the same API the browser drives, then the drain loop
 * shipping every queued write to the deployment of record.
 *
 *   node scripts/seam-pass.mjs        (server on :3108, dev-db, dev-drain)
 *
 * Two real wallets sign in over EIP-191; the seller lists a vehicle and
 * uploads an invoice; the buyer redeems a share link, disputes, and
 * uploads a counter-record; both consent; the seller submits. The script
 * then only WATCHES: the drain must link the on-chain id, land every
 * evidence write, record the dispute, and seal — and the intake receipt
 * must show every item inside the on-chain manifest. Exits non-zero if
 * any job fails or the receipt disagrees.
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.env.AUTOCOURT_URL ?? "http://localhost:3108";
const log = (s) => console.log(`[seam ${new Date().toISOString().slice(11, 19)}] ${s}`);

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
          ? { "content-type": "application/json" }
          : {}),
        cookie: this.cookie,
        ...(init.headers ?? {}),
      },
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`${this.name} ${path}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
    }
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
    log(`${this.name} signed in as ${this.account.address.slice(0, 10)}…`);
  }
}

async function upload(actor, assessmentId, filename, text, declaredClass, label) {
  const form = new FormData();
  form.set("file", new Blob([text], { type: "text/plain" }), filename);
  form.set("declaredClass", declaredClass);
  form.set("declaredLabel", label);
  form.set("captureDate", "2026-03-07");
  return actor.api(`/api/assessments/${assessmentId}/evidence`, {
    method: "POST",
    body: form,
  });
}

async function consent(actor, assessmentId, itemRowId) {
  return actor.api(
    `/api/assessments/${assessmentId}/evidence/${itemRowId}/consent`,
    { method: "POST", body: JSON.stringify({ consentVersion: "publicity-statement-1" }) },
  );
}

const seller = new Actor("Seam Seller");
const buyer = new Actor("Seam Buyer");
await seller.signIn();
await buyer.signIn();

// The seller lists the vehicle with two claims.
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
    ],
  }),
});
const assessment = await seller.api("/api/assessments", {
  method: "POST",
  body: JSON.stringify({ vehicleId: vehicle.id }),
});
log(`assessment ${assessment.id} opened`);

const invoice = await upload(
  seller, assessment.id, "invoice.txt",
  "SERVICE INVOICE 2026-03-07. Vehicle VIN 1M8GDM9AXKP042788. Odometer " +
  "reading 87,432 miles at service. Replaced front brake pads and rotors.",
  "SERVICE_INVOICE", "March invoice",
);
await seller.api(
  `/api/assessments/${assessment.id}/evidence/${invoice.id}/observations`,
  {
    method: "POST",
    body: JSON.stringify({
      rows: [{ docDate: "2026-03-07", odometerReading: 87432,
               odometerUnit: "MILES", sourceField: "odometer line" }],
    }),
  },
);
await consent(seller, assessment.id, invoice.id);

// The buyer arrives through a share link, disputes, and counters.
const link = await seller.api(`/api/assessments/${assessment.id}/share`, {
  method: "POST",
  body: JSON.stringify({ expiresInDays: 7 }),
});
await buyer.api(`/api/share/${link.token}`, { method: "POST" });
const detail = await buyer.api(`/api/assessments/${assessment.id}`);
const accidentClaim = detail.vehicle.claims.find((c) => c.type === "ACCIDENT_HISTORY");
await buyer.api(`/api/assessments/${assessment.id}/disputes`, {
  method: "POST",
  body: JSON.stringify({ claimRowIds: [accidentClaim.id], note: "history looks thin" }),
});
const history = await upload(
  buyer, assessment.id, "history.txt",
  "VEHICLE HISTORY RECORD. No accident records found for this vehicle. " +
  "Odometer reported 86,900 miles on 2026-01-15. Two previous owners.",
  "VEHICLE_HISTORY_RECORD", "History pull",
);
await consent(buyer, assessment.id, history.id);

const submitted = await seller.api(`/api/assessments/${assessment.id}/submit`, {
  method: "POST",
});
log(`submitted — manifest root ${submitted.manifestRoot.slice(0, 16)}…; the drain takes it from here`);

// Watch only: the drain must carry every write to the chain.
const DEADLINE = Date.now() + 15 * 60_000;
for (;;) {
  if (Date.now() > DEADLINE) {
    console.error("SEAM PASS FAILED — the pipeline did not finish in 15 minutes");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 12_000));
  const d = await seller.api(`/api/assessments/${assessment.id}`);
  const jobs = await seller.api(`/api/assessments/${assessment.id}/jobs`).catch(() => null);
  const failed = jobs?.jobs?.filter((j) => j.state === "FAILED") ?? [];
  if (failed.length > 0) {
    console.error(`SEAM PASS FAILED — job(s) failed: ${failed.map((j) => `${j.kind}: ${j.lastError}`).join("; ")}`);
    process.exit(1);
  }
  const pending = jobs?.jobs?.filter((j) => j.state !== "DONE") ?? [];
  log(`state ${d.state} · onChainId ${d.onChainId ?? "—"} · jobs pending ${pending.length}${pending.length ? ` (${pending.map((j) => j.kind).join(", ")})` : ""}`);
  if (d.onChainId && pending.length === 0) {
    const receipt = await seller.api(`/api/assessments/${assessment.id}/receipt`);
    const mine = receipt.myItems ?? [];
    const off = mine.filter((i) => !i.onChain);
    console.log("\n================ SEAM PASS REPORT ================");
    console.log(`assessment ${assessment.id} → on-chain ${d.onChainId} on ${receipt.contractAddress}`);
    for (const j of jobs.jobs) console.log(`  ${j.kind.padEnd(22)} ${j.state}  tx ${j.txHash ?? "—"}`);
    console.log(`intake receipt: ${mine.length} of my items checked, ${mine.length - off.length} on-chain`);
    console.log("==================================================");
    if (off.length > 0) {
      console.error("SEAM PASS FAILED — items missing from the on-chain record");
      process.exit(1);
    }
    console.log("SEAM PASS COMPLETE — browser-shaped API calls became an on-chain sealed record.");
    process.exit(0);
  }
}
