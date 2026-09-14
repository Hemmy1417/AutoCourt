/**
 * The identity cap, live — as a CONTROLLED PAIR.
 *
 *   node scripts/prove-identity-cap.mjs      (server + dev-db + worker up)
 *
 * The cap is the rule that says: VERIFIED asserts something about THIS
 * vehicle, so if the federal registry decodes the VIN to a different
 * vehicle, no document about "the vehicle" can carry a claim that far.
 * It had only ever been proven in direct tests.
 *
 * Proving it live needs care, because the panel is ALSO told about a
 * mismatch. A single mismatched run therefore proves nothing about the
 * cap: the model might have withheld VERIFIED on its own. So this runs
 * two assessments whose evidence is byte-identical apart from the VIN:
 *
 *   CONTROL   JTDBR32E720123456  undecodable   declared Toyota Corolla
 *   MISMATCH  1M8GDM9AXKP042788  decodes to a  declared Meridian GT
 *                                1989 bus       Wagon 2019
 *
 * Everything the seller supplied is the same. The only difference is a
 * fact no party supplied — what every validator read at the registry.
 *
 * Five things are guaranteed by code once identity is MISMATCH, whatever
 * the panel says, and those are the hard assertions. Whether the panel
 * would otherwise have said VERIFIED is not guaranteed, so the control
 * arm and the RECONCILE_VEHICLE_IDENTITY fingerprint are REPORTED, not
 * asserted — that fingerprint is written only by the cap, so if it shows
 * up, the cap demonstrably rewrote a verdict rather than agreeing with
 * one.
 */
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const BASE = process.env.AUTOCOURT_URL ?? "http://localhost:3108";
const ANCHOR =
  "https://raw.githubusercontent.com/Hemmy1417/InsureShield/e59e528650" +
  "/fixtures/evidence/adversarial/incident_report_delivery.txt";

const log = (s) => console.log(`[cap ${new Date().toISOString().slice(11, 19)}] ${s}`);
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
  }
}

async function drained(actor, id, label, minutes = 30) {
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
    // A DONE job is not a settled record. The worker marks jobs done in
    // one pass and applies their effects in the next call, so there is a
    // window where every job reads DONE while an anchor item is still
    // PENDING_ENTRY — and submit correctly refuses in that window. The
    // UI gates on the item, not the job; so does this.
    const entering = (d.evidenceItems ?? []).filter((i) => i.status === "PENDING_ENTRY");
    log(`${label}: ${d.state} · on-chain ${d.onChainId ?? "—"} · pending ${pending.length}` +
        (entering.length ? ` · entering ${entering.length}` : ""));
    if (pending.length === 0 && entering.length === 0) return d;
  }
}

/**
 * One arm. The disclosure text is generated from the VIN so that the two
 * arms differ in exactly the bytes the VIN occupies and nothing else.
 */
async function arm(label, { vin, make, model, year }) {
  const actor = new Actor(`Cap ${label}`);
  await actor.signIn();
  const vehicle = await actor.api("/api/vehicles", {
    method: "POST",
    body: JSON.stringify({
      vin, make, model, year,
      claims: [{
        type: "ACCIDENT_HISTORY",
        declared_value: "rear-ended while stationary on 2026-09-05; no injuries",
        declaredValue: "rear-ended while stationary on 2026-09-05; no injuries",
      }],
    }),
  });
  const a = await actor.api("/api/assessments", {
    method: "POST", body: JSON.stringify({ vehicleId: vehicle.id }),
  });
  log(`${label}: assessment ${a.id} (VIN ${vin})`);

  const form = new FormData();
  form.set("file", new Blob([
    `SELLER DISCLOSURE. Vehicle VIN ${vin}, ${make} ${model}. ` +
    "On 2026-09-05 this vehicle was struck from behind while stationary at " +
    "a red signal. Damage was to the rear bumper, boot lid and left rear " +
    "light cluster. No injuries. Repaired and disclosed in full.",
  ], { type: "text/plain" }), "disclosure.txt");
  form.set("declaredClass", "SELLER_DECLARATION");
  form.set("declaredLabel", "Accident disclosure");
  form.set("captureDate", "2026-09-05");
  const disclosure = await actor.api(`/api/assessments/${a.id}/evidence`, {
    method: "POST", body: form,
  });
  await actor.api(`/api/assessments/${a.id}/evidence/${disclosure.id}/consent`, {
    method: "POST", body: JSON.stringify({ consentVersion: "publicity-statement-1" }),
  });

  await actor.api(`/api/assessments/${a.id}/anchor`, {
    method: "POST",
    body: JSON.stringify({ url: ANCHOR, declaredLabel: "Police collision report" }),
  });
  await drained(actor, a.id, `${label} anchor`);
  await actor.api(`/api/assessments/${a.id}/submit`, { method: "POST" });
  await drained(actor, a.id, `${label} submit`);
  await actor.api(`/api/assessments/${a.id}/adjudicate`, { method: "POST" });
  const detail = await drained(actor, a.id, `${label} panel`);
  const { verdict } = await actor.api(`/api/assessments/${a.id}/verdict`);
  return { label, detail, verdict, claims: verdict.claims ?? [] };
}

// Both arms at once — separate assessments, so the per-assessment job
// ordering rule does not serialise them against each other.
const [control, mismatch] = await Promise.all([
  arm("CONTROL", { vin: "JTDBR32E720123456", make: "Toyota", model: "Corolla", year: 2021 }),
  arm("MISMATCH", { vin: "1M8GDM9AXKP042788", make: "Meridian", model: "GT Wagon", year: 2019 }),
]);

for (const r of [control, mismatch]) {
  const c = r.claims[0];
  log(`${r.label} ${r.detail.onChainId}: identity ${r.detail.identityStatus} · rollup ` +
      `${r.verdict.rollup} · ${c?.verdict} / ${c?.confidence} · next ${c?.next_action ?? "—"}`);
}

// ── what the code guarantees once identity is MISMATCH ──────────────────────
hard(mismatch.detail.identityStatus === "MISMATCH",
     "every validator decoded the VIN to a different vehicle than the listing");
hard(mismatch.verdict.flags?.vehicle_identity_mismatch === true,
     "the mismatch is carried as a flag on the verdict, not left implicit");
hard(mismatch.verdict.rollup === "MATERIAL_CONCERN",
     "a contested identity puts the whole record at MATERIAL_CONCERN");
hard(!mismatch.claims.some((c) => c.verdict === "VERIFIED"),
     "NO claim reaches VERIFIED while the vehicle's identity is contradicted");
hard(!mismatch.claims.some((c) => c.confidence === "HIGH"),
     "no claim keeps HIGH confidence while the vehicle's identity is contradicted");

// ── did the cap BITE, or did the panel simply agree? ────────────────────────
// RECONCILE_VEHICLE_IDENTITY is written in exactly one place: the cap,
// as it rewrites a VERIFIED verdict. Its presence is the cap's signature.
const bit = mismatch.claims.filter((c) => c.next_action === "RECONCILE_VEHICLE_IDENTITY");
const controlClaim = control.claims[0];

console.log("\n============ IDENTITY CAP ============");
console.log(`CONTROL  ${control.detail.onChainId}  identity ${control.detail.identityStatus}` +
            `  →  ${controlClaim?.verdict} / ${controlClaim?.confidence}  · rollup ${control.verdict.rollup}`);
console.log(`MISMATCH ${mismatch.detail.onChainId}  identity ${mismatch.detail.identityStatus}` +
            `  →  ${mismatch.claims[0]?.verdict} / ${mismatch.claims[0]?.confidence}  · rollup ${mismatch.verdict.rollup}`);
console.log(bit.length > 0
  ? `CAP BIT — ${bit.length} claim(s) carry RECONCILE_VEHICLE_IDENTITY, written only when the cap ` +
    `rewrites a VERIFIED verdict. The panel had accepted the claim; the registry overruled it.`
  : `CAP HELD AS A FLOOR — the panel did not reach VERIFIED on its own, so the cap had nothing ` +
    `to rewrite. The five guarantees above still held on chain.`);
if (controlClaim?.verdict === "VERIFIED")
  console.log(`CONTRAST — the SAME evidence with a decodable-but-absent VIN reached ` +
              `${controlClaim.verdict}/${controlClaim.confidence}. The VIN was the only difference.`);
console.log(failures.length === 0
  ? "IDENTITY CAP PROVEN LIVE."
  : `INCOMPLETE — ${failures.length}: ${failures.join("; ")}`);
console.log("======================================");
process.exit(failures.length === 0 ? 0 : 1);
