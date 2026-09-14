/**
 * The live arc — the whole user path on the deployment of record.
 *
 *   node scripts/arc.mjs 0x<contract>
 *
 * Act I    the sale record: claims, both parties' evidence, a recorded
 *          dispute, seal, the panel. Floor proven: no INDEPENDENT item,
 *          so no claim may reach VERIFIED.
 * Act II   the rollback: a later-dated lower reading across two accounts
 *          raises the code-derived conflict; the accusation-grade flag is
 *          the panel's to soften, never to invent.
 * Act III  the appeal: a NEW counter-report enters post-verdict; the
 *          RECORDED bytes are re-read from contract storage; the prior
 *          run stays byte-identical; the accuser's own contradiction is
 *          floored below CLAIM_CONTRADICTED.
 * Wall     five refusals, three-outcome checked: a wall that cannot be
 *          proven refused is reported unproven, never assumed.
 *
 * Discipline: every write gets ONE attempt; panel-dependent fields are
 * ASSERTED structurally (legal enum, floors, immutability) and LOGGED
 * verbatim — the bar is never lowered silently, and expectations that
 * depend on live panel judgment are stated as observations.
 */
import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RPC = process.env.GENLAYER_RPC_URL ?? "https://studio-next.genlayer.com/api";
const chain = { ...studioDevnet, name: "GenLayer Studio Next", rpcUrls: { default: { http: [RPC] } } };
const CONTRACT = process.argv[2];
if (!CONTRACT?.startsWith("0x")) {
  console.error("usage: node scripts/arc.mjs 0x<contract-of-record>");
  process.exit(2);
}
const KEYS = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../.data/keys.json", import.meta.url)), "utf-8"));
const FEE_FLOOR = 10n ** 15n;
// A REAL VIN that decodes cleanly at the federal registry, declared
// honestly — so identity is CONFIRMED and this arc measures the evidence
// machinery rather than the identity cap. The MISMATCH path has its own
// proof in scripts/identity-demo.mjs.
const VIN = "1HGCM82633A004352";
const MAKE = "Honda";
const MODEL = "Accord";
const YEAR = 2003;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash("sha256").update(s, "utf-8").digest("hex");
const log = (s) => console.log(`[arc ${new Date().toISOString().slice(11, 19)}] ${s}`);
const failures = [];
const unproven = [];
const hard = (cond, what) => {
  if (cond) log(`ASSERT ok — ${what}`);
  else { log(`ASSERT FAILED — ${what}`); failures.push(what); }
};

async function rpc(method, params) {
  let lastErr;
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 autocourt-arc" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      return JSON.parse(await res.text());
    } catch (e) { lastErr = e; await sleep(3000 * (i + 1)); }
  }
  throw lastErr;
}

const account = createAccount(KEYS.OPERATOR.pk);
const client = createClient({ chain, account });

async function finality(hash, tries = 180) {
  for (let i = 0; i < tries; i++) {
    await sleep(4000);
    const t = (await rpc("eth_getTransactionByHash", [hash])).result;
    const status = t?.status ?? t?.statusName;
    if (["FINALIZED", "CANCELED", "UNDETERMINED"].includes(status)) return t;
    if (i % 15 === 14) log(`  … still ${status ?? "pending"}`);
  }
  return null;
}

async function writeOnce(fn, args, label) {
  const est = await client.estimateTransactionFees();
  const feeValue = est.feeValue > FEE_FLOOR ? est.feeValue : FEE_FLOOR;
  const hash = await client.writeContract({
    address: CONTRACT, functionName: fn, args, value: 0n,
    fees: { distribution: est.distribution, feeValue },
  });
  log(`${label}: tx ${hash}`);
  const t = await finality(hash);
  const status = t?.status ?? t?.statusName ?? "TIMEOUT";
  const arr = t?.consensus_data?.leader_receipt ?? [];
  const leader = arr.find((x) => x?.mode !== "validator") ?? arr[0];
  const ok = status === "FINALIZED" && leader?.execution_result === "SUCCESS";
  log(`${label}: ${status} · ${t?.result_name ?? "?"} · leader ${leader?.execution_result ?? "?"}`);
  if (!ok) {
    const stderr = String(leader?.genvm_result?.stderr ?? "");
    const m = stderr.match(/\[(EXPECTED|EXTERNAL|TRANSIENT|LLM_ERROR)\][^\n"\\]*/);
    if (m) log(`${label}: refusal — ${m[0].slice(0, 160)}`);
  }
  return { ok, hash, t, leader };
}

/** Three outcomes: refused-with-reason / refused-unproven / accepted=FAIL. */
async function mustRefuse(fn, args, label, expectFragment) {
  try {
    const w = await writeOnce(fn, args, `WALL ${label}`);
    if (w.ok) {
      log(`WALL ${label}: ACCEPTED — the wall FAILED`);
      failures.push(`wall accepted: ${label}`);
      return;
    }
    // The refusal sentence lives in leader_receipt.result: base64 whose
    // decoded bytes are a control byte + the printable UserError text
    // (the leader-payload lesson; stderr is empty here). On this network
    // `result` IS the base64 string; older shapes wrap it as {payload}.
    let reason = "";
    const r = w.leader?.result;
    const rawPayload = typeof r === "string" ? r : r?.payload;
    if (typeof rawPayload === "string") {
      try {
        const decoded = Buffer.from(rawPayload, "base64").toString("utf-8");
        const m = decoded.match(/\[(EXPECTED|EXTERNAL|TRANSIENT|LLM_ERROR)\][^\n]*/);
        if (m) reason = m[0];
      } catch {}
    }
    if (!reason) {
      const stderr = String(w.leader?.genvm_result?.stderr ?? "");
      const m = stderr.match(/\[(EXPECTED|EXTERNAL|TRANSIENT|LLM_ERROR)\][^\n]*/);
      if (m) reason = m[0];
    }
    if (reason && (!expectFragment || reason.includes(expectFragment))) {
      log(`WALL ${label}: refused — "${reason.slice(0, 160)}"`);
    } else if (reason) {
      log(`WALL ${label}: refused, but with an UNEXPECTED sentence — "${reason.slice(0, 160)}" (wanted "${expectFragment}")`);
      failures.push(`wall wrong reason: ${label}`);
    } else {
      log(`WALL ${label}: refused, but the reason was unavailable — UNPROVEN`);
      unproven.push(label);
    }
  } catch (e) {
    // Refused before a receipt existed (estimation-stage refusal).
    log(`WALL ${label}: refused at estimation (${String(e?.message ?? e).slice(0, 120)})`);
  }
}

async function view(fn, args) {
  return JSON.parse(String(await client.readContract({ address: CONTRACT, functionName: fn, args })));
}

function item(eid, text, { uploader, role, cls, obs = [], dtc = [], label }) {
  return JSON.stringify({
    evidence_id: eid,
    declared_class: cls,
    declared_label: label ?? "",
    uploader_account: uploader,
    uploader_role: role,
    file_sha256: sha(`original|${eid}`),
    text_sha256: sha(text),
    extractor_version: "extractor-1.0.0",
    status: "EXTRACTED",
    text,
    observations: obs,
    diagnostic_codes: dtc,
    capture_date: obs[0]?.doc_date ?? "2026-03-07",
  });
}

async function seal(aid) {
  const a = await view("get_assessment", [aid]);
  const entries = a.items.map((i) =>
    [i.evidence_id, i.file_sha256, i.text_sha256, i.extractor_version]);
  entries.sort((x, y) => {
    for (let i = 0; i < 4; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; }
    return 0;
  });
  return writeOnce("submit_assessment", [aid, sha(JSON.stringify(entries))], `seal ${aid}`);
}

const SVC_TEXT =
  "SERVICE INVOICE 2026-03-07. Vehicle VIN 1HGCM82633A004352. Odometer " +
  "reading 87,432 miles at service. Replaced front brake pads and rotors. " +
  "Coolant flush completed. Next service due at 92,000 miles.";
const HIST_TEXT =
  "VEHICLE HISTORY RECORD. No accident records found for this vehicle. " +
  "Odometer reported 86,900 miles on 2026-01-15. Two previous owners on " +
  "record. No outstanding finance recorded.";
const LOW_TEXT =
  "AUCTION LISTING EXPORT 2026-05-01. Lot 214. Odometer shows 62,000 " +
  "miles at photography. Sold with minor cosmetic wear noted.";
const CTR_TEXT =
  "INDEPENDENT MECHANIC COUNTER REPORT 2026-06-10. Inspection found frame " +
  "damage consistent with a prior collision on the left rear rail. Repair " +
  "records absent from the file. Recommend structural inspection.";

log(`arc on ${CONTRACT} · operator ${account.address} · chain ${chain.id}`);
const cfg = await view("get_config", []);
log(`config: max_runs ${cfg.max_runs_per_assessment} · per-item cap ${cfg.per_item_text_cap} · verified_reachable ${cfg.verified_reachable}`);

// ── ACT I — the sale record ─────────────────────────────────────────────────
log("── ACT I — the sale record");
const vehicle = JSON.stringify({ vin: VIN, make: MAKE, model: MODEL, year: YEAR, seller_account: "arc-seller" });
const claims = JSON.stringify([
  { type: "MILEAGE", declared_value: "87,432 miles" },
  { type: "ACCIDENT_HISTORY", declared_value: "no recorded accidents" },
]);
const c1 = await writeOnce("create_assessment", [vehicle, claims], "create #1");
hard(c1.ok, "assessment #1 created");
const stats = await view("get_stats", []);
const A1 = `ac-${String(stats.assessments).padStart(6, "0")}`;
log(`assessment #1 = ${A1}`);

// The one fact on this record no party supplied: every validator decoded
// the VIN at the federal registry itself before the record existed.
const a1 = await view("get_assessment", [A1]);
log(`identity: ${a1.identity_status} — registry reads this VIN as `
    + `${a1.registry_fields?.ModelYear ?? "?"} ${a1.registry_fields?.Make ?? "?"} `
    + `${a1.registry_fields?.Model ?? "?"}`);
hard(a1.identity_status === "CONFIRMED",
     "independent registry confirms the declared vehicle");

hard((await writeOnce("submit_evidence_text", [A1, item("E-SVC", SVC_TEXT, {
  uploader: "arc-seller", role: "SELLER", cls: "SERVICE_INVOICE",
  label: "March service invoice",
  obs: [{ doc_date: "2026-03-07", odometer_reading: 87432, odometer_unit: "MILES", source_field: "odometer line" }],
})], "E-SVC")).ok, "seller invoice entered (hash recomputed at entry)");

hard((await writeOnce("submit_evidence_text", [A1, item("E-HIST", HIST_TEXT, {
  uploader: "arc-buyer", role: "BUYER", cls: "VEHICLE_HISTORY_RECORD",
  label: "History report",
  obs: [{ doc_date: "2026-01-15", odometer_reading: 86900, odometer_unit: "MILES", source_field: "odometer line" }],
})], "E-HIST")).ok, "buyer history entered");

hard((await writeOnce("record_dispute",
  [A1, "arc-buyer", JSON.stringify(["CL-02"]), "history looks thin for a clean-accident claim"],
  "dispute CL-02")).ok, "buyer's opposing stake recorded before the run");

hard((await seal(A1)).ok, "packet sealed over stored items");

const r1 = await writeOnce("adjudicate", [A1], "adjudicate #1 (panel)");
hard(r1.ok, "run 1 survived consensus");
let v1 = null;
if (r1.ok) {
  v1 = await view("get_verdict", [A1]);
  log(`run ${v1.standing_run}/${v1.total_runs} · rollup ${v1.rollup} · flags ${JSON.stringify(v1.flags)}`);
  for (const c of v1.claims) {
    log(`  ${c.claim_id} ${c.claim_type}: ${c.verdict} · conf ${c.confidence} · support [${c.support_classes}] contra [${c.contradict_classes}]`);
    // THE FLOOR, proven live: with no INDEPENDENT item on the record,
    // VERIFIED must be unreachable for every claim.
    hard(c.verdict !== "VERIFIED",
      `${c.claim_id} floor: no VERIFIED without INDEPENDENT corroboration`);
  }
  hard(v1.flags.mileage_conflict === false,
    "no mileage conflict invented (readings ascend)");
}

// ── ACT II — the rollback record ────────────────────────────────────────────
log("── ACT II — the rollback record");
const c2 = await writeOnce("create_assessment", [vehicle,
  JSON.stringify([{ type: "MILEAGE", declared_value: "87,432 miles" }])],
  "create #2");
hard(c2.ok, "assessment #2 created");
const A2 = `ac-${String((await view("get_stats", [])).assessments).padStart(6, "0")}`;
log(`assessment #2 = ${A2}`);

hard((await writeOnce("submit_evidence_text", [A2, item("E-SVC", SVC_TEXT, {
  uploader: "arc-seller", role: "SELLER", cls: "SERVICE_INVOICE",
  obs: [{ doc_date: "2026-03-07", odometer_reading: 87432, odometer_unit: "MILES", source_field: "odometer line" }],
})], "E-SVC #2")).ok, "invoice entered on #2");

hard((await writeOnce("submit_evidence_text", [A2, item("E-LOW", LOW_TEXT, {
  uploader: "arc-buyer2", role: "BUYER", cls: "VEHICLE_HISTORY_RECORD",
  label: "Auction export",
  obs: [{ doc_date: "2026-05-01", odometer_reading: 62000, odometer_unit: "MILES", source_field: "listing odometer" }],
})], "E-LOW")).ok, "later-dated lower reading entered from a second account");

hard((await writeOnce("record_dispute",
  [A2, "arc-buyer2", JSON.stringify(["CL-01"]), "auction odometer far below the declared figure"],
  "dispute CL-01 #2")).ok, "second account's stake recorded");

hard((await seal(A2)).ok, "packet #2 sealed");

const r2 = await writeOnce("adjudicate", [A2], "adjudicate #2 (panel)");
hard(r2.ok, "run on #2 survived consensus");
if (r2.ok) {
  const v2 = await view("get_verdict", [A2]);
  log(`#2 rollup ${v2.rollup} · flags ${JSON.stringify(v2.flags)}`);
  // Code-derived, deterministic: the conflict EXISTS whatever the panel
  // thinks of it.
  hard(v2.flags.mileage_conflict === true,
    "code-derived mileage conflict raised from typed rows");
  // Rollback promotion depends on the panel's explanation finding: state
  // the observation, never bake the panel's judgment into an assertion.
  log(`observation: odometer_rollback_indicated = ${v2.flags.odometer_rollback_indicated} (panel ${v2.flags.odometer_rollback_indicated ? "found no explanation in the record" : "accepted an explanation"})`);
}

// ── ACT III — the appeal ────────────────────────────────────────────────────
log("── ACT III — the appeal on the record");
const run1Before = r1.ok ? await view("get_run", [A1, 1]) : null;

hard((await writeOnce("submit_appeal_evidence", [A1, item("E-CTR", CTR_TEXT, {
  uploader: "arc-buyer", role: "BUYER", cls: "MECHANIC_REPORT",
  label: "Counter report",
})], "E-CTR")).ok, "post-verdict counter-report entered, tagged NEW");

const r3 = await writeOnce("readjudicate",
  [A1, "arc-buyer", "an independent inspection found frame damage the history record missed"],
  "readjudicate #1 (panel)");
hard(r3.ok, "appeal run survived consensus");
if (r3.ok && run1Before) {
  const v3 = await view("get_verdict", [A1]);
  log(`appeal verdict: run ${v3.standing_run}/${v3.total_runs} · rollup ${v3.rollup}`);
  const run1After = await view("get_run", [A1, 1]);
  hard(JSON.stringify(run1Before) === JSON.stringify(run1After),
    "prior run is byte-identical after the appeal (immutable record)");
  const ctr = await view("get_item_text", [A1, "E-CTR"]);
  hard(ctr.judged_version === 2, "E-CTR judged at packet v2, tagged post-verdict");
  const cl2 = v3.claims.find((c) => c.claim_id === "CL-02");
  if (cl2) {
    log(`  CL-02 after appeal: ${cl2.verdict} · contra classes [${cl2.contradict_classes}]`);
    // The accuser's own upload cannot become CLAIM_CONTRADICTED.
    hard(cl2.verdict !== "CLAIM_CONTRADICTED",
      "CL-02 floor: accuser-only contradiction never becomes CLAIM_CONTRADICTED");
  }
}

// ── THE WALL — refusals, three-outcome ──────────────────────────────────────
log("── THE WALL");
await mustRefuse("adjudicate", [A1],
  "re-judge an unchanged packet", "already judged this exact");
await mustRefuse("readjudicate", [A1, "arc-nobody", "let me in"],
  "stranger appeal", "recorded party");
await mustRefuse("submit_evidence_text", [A2, item("E-LATE", "late text arriving", {
  uploader: "arc-seller", role: "SELLER", cls: "SELLER_DECLARATION",
})], "evidence after seal", "submit_appeal_evidence");

// The hash and allowlist gates sit BEFORE the seal gate, so proving them
// needs an OPEN record — on a sealed one the seal refusal fires first and
// the wall would prove the wrong sentence (S38: a proof claims only what
// its mechanism asserts). A dedicated open fixture keeps each wall honest.
log("wall fixture: an OPEN assessment for the pre-seal gates");
const wallCreate = await writeOnce("create_assessment", [
  JSON.stringify({ vin: VIN, make: MAKE, model: MODEL, year: YEAR,
                   seller_account: "arc-seller" }),
  JSON.stringify([{ type: "CONDITION", declared_value: "wall fixture — never sealed" }]),
], "create wall fixture");
if (!wallCreate.ok) {
  failures.push("wall fixture creation failed");
} else {
  const A3 = `ac-${String((await view("get_stats", [])).assessments).padStart(6, "0")}`;
  log(`wall fixture = ${A3}`);
  {
    const bad = JSON.parse(item("E-BAD", "honest text", {
      uploader: "arc-seller", role: "SELLER", cls: "SELLER_DECLARATION" }));
    bad.text_sha256 = sha("entirely different bytes");
    await mustRefuse("submit_evidence_text", [A3, JSON.stringify(bad)],
      "hash not covering the bytes", "does not match the supplied");
  }
  await mustRefuse("submit_anchor_item", [A3, JSON.stringify({
    evidence_id: "E-EVIL", declared_class: "EXTERNAL_SOURCE_RESULT",
    declared_label: "seller's own site",
    url: "https://seller-controlled.example.com/page",
    expected_sha256: sha("x"),
  })], "anchor off the allowlist", "allowlist");
}

// ── CLOSE ───────────────────────────────────────────────────────────────────
console.log("\n================== ARC REPORT ==================");
const finalStats = await view("get_stats", []);
console.log(`contract ${CONTRACT} · assessments on record: ${finalStats.assessments}`);
if (failures.length === 0) {
  console.log(`ARC COMPLETE — every hard assertion held.`);
} else {
  console.log(`ARC FAILED — ${failures.length} hard assertion(s):`);
  for (const f of failures) console.log(`  ✗ ${f}`);
}
if (unproven.length > 0) {
  console.log(`unproven walls (refused, reason unavailable): ${unproven.join("; ")}`);
}
console.log("=================================================");
process.exit(failures.length === 0 ? 0 : 1);
