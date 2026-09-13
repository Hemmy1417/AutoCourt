/**
 * The independent-source lane, driven THROUGH THE APP.
 *
 *   node scripts/anchor-app-demo.mjs        (server + dev-db + dev-drain up)
 *
 * scripts/anchor-demo.mjs proves the contract half by talking to the
 * chain directly. This proves the half that matters to a user: that the
 * lane is reachable from the product at all. It signs in with a fresh
 * wallet, is refused when it names a party-controlled source, adds an
 * allowlisted one, and waits for the drain to carry it to the chain —
 * where every validator fetches it and must agree before it can be
 * judged.
 *
 * Exit 0 = EXTRACTED (agreed, so VERIFIED is reachable), 2 = the honest
 * failure path (validators did not agree; recorded, never judged).
 */
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
const BASE = "http://localhost:3108";
const ANCHOR = "https://raw.githubusercontent.com/Hemmy1417/CredenceLend/b51cc1b839c7f89c2564d93b9534d1f9d92139bf/fixtures/borrower/ada-statement.txt";
const acct = privateKeyToAccount(generatePrivateKey());
let cookie = "";
const api = async (p, i = {}) => {
  const r = await fetch(BASE + p, { ...i, headers: { ...(i.body ? { "content-type": "application/json" } : {}), cookie, ...(i.headers ?? {}) } });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  return { status: r.status, body: await r.json().catch(() => null) };
};
const log = (s) => console.log(`[anchor-app ${new Date().toISOString().slice(11,19)}] ${s}`);

const n = await api("/api/auth/nonce", { method: "POST", body: JSON.stringify({ address: acct.address }) });
const sig = await acct.signMessage({ message: n.body.message });
await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ address: acct.address, nonce: n.body.nonce, signature: sig, displayName: "Anchor Probe" }) });
log(`signed in ${acct.address.slice(0,10)}…`);

const v = await api("/api/vehicles", { method: "POST", body: JSON.stringify({ vin: "1HGCM82633A004352", make: "Honda", model: "Accord", year: 2003, claims: [{ type: "MILEAGE", declaredValue: "87,432 miles" }] }) });
const a = await api("/api/assessments", { method: "POST", body: JSON.stringify({ vehicleId: v.body.id }) });
log(`assessment ${a.body.id}`);

// A source NOT on the allowlist must be refused with the reason in words.
const bad = await api(`/api/assessments/${a.body.id}/anchor`, { method: "POST", body: JSON.stringify({ url: "https://seller-controlled.example.com/page", declaredLabel: "mine" }) });
log(`off-allowlist source: ${bad.status} — "${bad.body?.message}"`);

const ok = await api(`/api/assessments/${a.body.id}/anchor`, { method: "POST", body: JSON.stringify({ url: ANCHOR, declaredLabel: "Independent statement" }) });
log(`allowlisted source: ${ok.status} — ${ok.body?.item?.evidenceId} status ${ok.body?.item?.status}, expected ${String(ok.body?.expected).slice(0,16)}…`);
if (ok.status !== 201) process.exit(1);

const DEADLINE = Date.now() + 10 * 60_000;
for (;;) {
  if (Date.now() > DEADLINE) { console.error("TIMEOUT"); process.exit(1); }
  await new Promise(r => setTimeout(r, 12_000));
  const d = await api(`/api/assessments/${a.body.id}`);
  const item = d.body.evidenceItems.find(i => i.lane === "ANCHOR");
  const jobs = await api(`/api/assessments/${a.body.id}/jobs`);
  const failed = jobs.body.jobs.filter(j => j.state === "FAILED");
  if (failed.length) { console.error("JOB FAILED:", failed.map(j => `${j.kind}: ${j.lastError}`).join("; ")); process.exit(1); }
  log(`on-chain ${d.body.onChainId ?? "—"} · anchor status ${item?.status} · jobs pending ${jobs.body.jobs.filter(j=>j.state!=="DONE").length}`);
  if (item && item.status !== "PENDING_ENTRY") {
    console.log("\n========== ANCHOR LANE THROUGH THE APP ==========");
    console.log(`assessment ${d.body.onChainId}`);
    console.log(`source      ${ANCHOR.slice(0, 88)}…`);
    console.log(`status      ${item.status}`);
    console.log(`file hash   ${item.fileSha256}`);
    console.log(`text hash   ${item.textSha256}`);
    console.log(`tx          ${item.onChainTxHash}`);
    console.log("=================================================");
    console.log(item.status === "EXTRACTED"
      ? "Every validator fetched it and agreed — this claim can now reach VERIFIED."
      : "Validators did not agree on the bytes; recorded unavailable and never judged (the honest path).");
    process.exit(item.status === "EXTRACTED" ? 0 : 2);
  }
}
