/**
 * The two outcomes no live round had ever produced.
 *
 *   node scripts/prove-verified.mjs        (server + dev-db + worker up)
 *
 * A. VERIFIED. The flagship verdict, and the whole point of the anchor
 *    lane: a claim reaches it ONLY with INDEPENDENT corroboration — a
 *    document fetched and hash-agreed by every validator, that no party
 *    could author. Until now that was proven in direct tests and never
 *    on chain, which meant the strongest claim the product makes had
 *    never actually been made.
 *
 *    The seller DISCLOSES an accident honestly, and an independent police
 *    collision report naming the same VIN corroborates the disclosure.
 *    Honesty plus independent corroboration is exactly the case that
 *    should earn VERIFIED, and nothing weaker should.
 *
 * B. DIAGNOSTIC_CONCERN_SUPPORTED. A stored trouble code is never an
 *    auto-failure; the flag needs the panel to find symptom support in
 *    the evidence. Also never fired live.
 *
 * The anchor is a real public document (an InsureShield test fixture,
 * commit-pinned) on the deployment's allowlisted host. Its VIN decodes
 * UNDECODABLE at the federal registry, which by design does NOT cap —
 * absence of confirmation is not an accusation — so this run also proves
 * that branch on chain.
 */
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const BASE = process.env.AUTOCOURT_URL ?? "http://localhost:3108";
const ANCHOR =
  "https://raw.githubusercontent.com/Hemmy1417/InsureShield/e59e528650" +
  "/fixtures/evidence/adversarial/incident_report_delivery.txt";
const VIN = "JTDBR32E720123456";

const log = (s) => console.log(`[prove ${new Date().toISOString().slice(11, 19)}] ${s}`);
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

async function drained(actor, id, label, minutes = 25) {
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
    // A DONE job is not a settled record: the worker marks jobs done in
    // one call and applies their effects in the next, so an anchor item
    // can still be PENDING_ENTRY while every job reads DONE — and submit
    // rightly refuses then. Gate on the item, as the UI does.
    const entering = (d.evidenceItems ?? []).filter((i) => i.status === "PENDING_ENTRY");
    log(`${label}: ${d.state} · on-chain ${d.onChainId ?? "—"} · pending ${pending.length}` +
        (entering.length ? ` · entering ${entering.length}` : ""));
    if (pending.length === 0 && entering.length === 0) return d;
  }
}

const ONLY = process.argv[2]; // "A" or "B"; both by default

const seller = new Actor("Prove Seller");
await seller.signIn();

// ── A. the honest disclosure, independently corroborated ────────────────────
let claimA = null, withAnchor = null;
if (ONLY !== "B") {
log("A — a disclosed accident, corroborated by an independent police report");
const v1 = await seller.api("/api/vehicles", {
  method: "POST",
  body: JSON.stringify({
    vin: VIN, make: "Toyota", model: "Corolla", year: 2021,
    claims: [{
      type: "ACCIDENT_HISTORY",
      declared_value: "rear-ended while stationary on 2026-09-05; no injuries",
      declaredValue: "rear-ended while stationary on 2026-09-05; no injuries",
    }],
  }),
});
const a1 = await seller.api("/api/assessments", {
  method: "POST", body: JSON.stringify({ vehicleId: v1.id }),
});

const disclosure = await upload(seller, a1.id, "disclosure.txt",
  "SELLER DISCLOSURE. Vehicle VIN JTDBR32E720123456, Toyota Corolla. " +
  "On 2026-09-05 this vehicle was struck from behind while stationary at " +
  "a red signal. Damage was to the rear bumper, boot lid and left rear " +
  "light cluster. No injuries. Repaired and disclosed in full.",
  "SELLER_DECLARATION", "Accident disclosure", "2026-09-05");
await consent(seller, a1.id, disclosure.id);

const anchor = await seller.api(`/api/assessments/${a1.id}/anchor`, {
  method: "POST",
  body: JSON.stringify({ url: ANCHOR, declaredLabel: "Police collision report" }),
});
log(`independent source queued as ${anchor.item.evidenceId}`);
await drained(seller, a1.id, "A: anchor");
withAnchor = await seller.api(`/api/assessments/${a1.id}`);
const anchorItem = withAnchor.evidenceItems.find((i) => i.lane === "ANCHOR");
hard(anchorItem?.status === "EXTRACTED",
     "the independent source was fetched and hash-agreed by every validator");
hard(withAnchor.identityStatus === "UNDECODABLE",
     "an undecodable VIN is recorded as absence, not as an accusation");

await seller.api(`/api/assessments/${a1.id}/submit`, { method: "POST" });
await drained(seller, a1.id, "A: submit");
await seller.api(`/api/assessments/${a1.id}/adjudicate`, { method: "POST" });
log("A: adjudicating");
await drained(seller, a1.id, "A: panel");
const verdictA = await seller.api(`/api/assessments/${a1.id}/verdict`);
claimA = verdictA.verdict.claims?.[0];
log(`A: ${claimA?.claim_type} → ${claimA?.verdict} · confidence ${claimA?.confidence} · support ${JSON.stringify(claimA?.support_classes)}`);
hard(claimA?.verdict === "VERIFIED",
     "a disclosed claim with INDEPENDENT corroboration reaches VERIFIED");
hard((claimA?.support_classes ?? []).includes("INDEPENDENT"),
     "the verdict rests on INDEPENDENT support, not the seller's own word");
}

// ── B. a trouble code that the evidence actually supports ───────────────────
let verdictB = null;
if (ONLY !== "A") {
log("B — a diagnostic code with symptom support in the record");
const v2 = await seller.api("/api/vehicles", {
  method: "POST",
  body: JSON.stringify({
    vin: "1HGCM82633A004352", make: "Honda", model: "Accord", year: 2003,
    claims: [{ type: "CONDITION", declaredValue: "runs smoothly, no faults" }],
  }),
});
const a2 = await seller.api("/api/assessments", {
  method: "POST", body: JSON.stringify({ vehicleId: v2.id }),
});
const scan = await upload(seller, a2.id, "scan.txt",
  "OBD-II SCANNER REPORT 2026-06-02. Vehicle VIN 1HGCM82633A004352.\n" +
  "Stored trouble code P0301 — cylinder 1 misfire detected.\n" +
  "Owner reports a persistent rough idle and hesitation under load since " +
  "May. Engine management light is illuminated. Misfire counter rising on " +
  "cylinder 1 during the road test.",
  "DIAGNOSTIC_SCANNER_REPORT", "Scanner report", "2026-06-02");
await seller.api(`/api/assessments/${a2.id}/evidence/${scan.id}/observations`, {
  method: "POST",
  body: JSON.stringify({ rows: [{ docDate: "2026-06-02", diagnosticCode: "P0301", sourceField: "stored codes" }] }),
});
await consent(seller, a2.id, scan.id);
await seller.api(`/api/assessments/${a2.id}/submit`, { method: "POST" });
await drained(seller, a2.id, "B: submit");
await seller.api(`/api/assessments/${a2.id}/adjudicate`, { method: "POST" });
log("B: adjudicating");
await drained(seller, a2.id, "B: panel");
verdictB = await seller.api(`/api/assessments/${a2.id}/verdict`);
log(`B: rollup ${verdictB.verdict.rollup} · flags ${JSON.stringify(verdictB.verdict.flags)}`);
hard(verdictB.verdict.flags?.diagnostic_concern_supported === true,
     "a trouble code with symptom support raises the diagnostic flag");
}

console.log("\n============== PROOF RUN ==============");
if (withAnchor) console.log(`A ${withAnchor.onChainId}: ${claimA?.verdict} (${(claimA?.support_classes ?? []).join(", ")}) · identity ${withAnchor.identityStatus}`);
if (verdictB) console.log(`B: rollup ${verdictB.verdict.rollup} · diagnostic ${verdictB.verdict.flags?.diagnostic_concern_supported}`);
console.log(failures.length === 0
  ? "PROOF COMPLETE — VERIFIED and the diagnostic flag are now live facts."
  : `PROOF INCOMPLETE — ${failures.length}: ${failures.join("; ")}`);
console.log("=======================================");
process.exit(failures.length === 0 ? 0 : 1);
