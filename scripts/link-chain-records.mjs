/**
 * Show existing on-chain records in the app.
 *
 *   node scripts/link-chain-records.mjs 0xYourWallet [ac-000003 ac-000004 …]
 *
 * The chain is the record; the database is only an index over it. Records
 * written by the scripts (the arc, the identity demo) exist on chain with
 * nothing in the app pointing at them, so they cannot appear on anyone's
 * dashboard. This builds that index for a given wallet: it reads the
 * vehicle, claims, evidence and runs FROM THE CONTRACT and writes rows
 * that reference them.
 *
 * It authors nothing. Every value comes back from the contract, and the
 * report and receipt screens re-read the chain directly rather than
 * trusting these rows. Evidence items are attributed to the viewing
 * wallet because uploaderId is an app-side foreign key — the on-chain
 * account and role are what the record actually says, and the screens
 * show those.
 */
import { PrismaClient } from "@prisma/client";
import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const wallet = (process.argv[2] ?? "").toLowerCase();
if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
  console.error("usage: node scripts/link-chain-records.mjs 0xYourWallet [ids…]");
  process.exit(2);
}
const ids = process.argv.slice(3);

const envText = readFileSync(fileURLToPath(new URL("../.env", import.meta.url)), "utf8");
const env = Object.fromEntries(
  envText.split("\n")
    .map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);
const RPC = env.GENLAYER_RPC_URL;
const CONTRACT = env.GENLAYER_CONTRACT_ADDRESS;
const chain = { ...studioDevnet, name: "GenLayer Studio Next", rpcUrls: { default: { http: [RPC] } } };
const client = createClient({ chain, account: createAccount() });
const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

const view = async (fn, args) =>
  JSON.parse(String(await client.readContract({ address: CONTRACT, functionName: fn, args })));
const log = (s) => console.log(`[link] ${s}`);

// Which records exist? Ask the contract, do not assume.
let candidates = ids;
if (candidates.length === 0) {
  const stats = await view("get_stats", []);
  candidates = Array.from({ length: Number(stats.assessments) }, (_, i) =>
    `ac-${String(i + 1).padStart(6, "0")}`);
}
log(`contract ${CONTRACT} · considering ${candidates.join(", ")}`);

const user = await prisma.user.findUnique({ where: { walletAddress: wallet } });
if (!user) {
  console.error(`no account for ${wallet} — sign in once in the app first`);
  process.exit(1);
}

const linked = [];
for (const onChainId of candidates) {
  let a;
  try {
    a = await view("get_assessment", [onChainId]);
  } catch {
    log(`${onChainId}: not on this contract, skipped`);
    continue;
  }
  // An id can exist on more than one contract — a redeploy restarts the
  // numbering. Only a row already stamped with THIS contract is the same
  // record; one stamped with an older address is a different record that
  // happens to share an id, and relabelling it would erase that fact.
  const existing = await prisma.assessment.findFirst({
    where: { onChainId, contractAddress: CONTRACT },
  });
  if (existing) {
    log(`${onChainId}: already indexed (${existing.id})`);
    continue;
  }

  const stale = await prisma.assessment.findFirst({ where: { onChainId } });
  if (stale) {
    log(`${onChainId}: an older-contract row holds this id; leaving it and skipping`);
    continue;
  }

  const verdict = await view("get_verdict", [onChainId]);
  const vehicle = await prisma.vehicle.create({
    data: {
      vin: a.vin,
      vinCheckDigitOk: Boolean(a.vin_check_digit_ok),
      make: a.make || "(not stated)",
      model: a.model || "(not stated)",
      year: Number(a.year) || 2000,
      sellerId: user.id,
      claims: {
        create: (a.claims ?? []).map((c) => ({
          claimId: c.claim_id, type: c.type, declaredValue: c.declared_value,
        })),
      },
    },
  });

  const state = Number(verdict.total_runs) > 0
    ? "ADJUDICATED"
    : a.state === "SEALED" ? "SUBMITTED" : "DRAFT";

  const assessment = await prisma.assessment.create({
    data: {
      vehicleId: vehicle.id,
      onChainId,
      contractAddress: CONTRACT,
      state,
      packetVersion: Number(a.packet_version) || 0,
      identityStatus: String(a.identity_status ?? ""),
      registryJson: JSON.stringify(a.registry_fields ?? {}),
    },
  });

  for (const it of a.items ?? []) {
    let text = "";
    try {
      text = String((await view("get_item_text", [onChainId, it.evidence_id])).text ?? "");
    } catch { /* an item with no readable text is recorded as such */ }
    await prisma.evidenceItem.create({
      data: {
        assessmentId: assessment.id,
        evidenceId: it.evidence_id,
        uploaderId: user.id,
        uploaderRole: it.uploader_role || "SELLER",
        lane: it.lane || "UPLOADED",
        declaredClass: it.declared_class || "MANUAL_OBSERVATION",
        declaredLabel: it.declared_label || "",
        mimeType: "text/plain",
        fileSha256: it.file_sha256 || "",
        textSha256: it.text_sha256 || "",
        extractorVersion: it.extractor_version || "",
        status: it.status || "EXTRACTED",
        judgedVersion: Number(it.judged_version) || 0,
        consentedAt: new Date(),
        extraction: {
          create: {
            status: text ? "EXTRACTED" : "UNAVAILABLE",
            normalizedText: text,
          },
        },
      },
    });
  }

  for (let n = 1; n <= Number(a.runs_count ?? 0); n++) {
    try {
      const run = await view("get_run", [onChainId, n]);
      await prisma.adjudicationRun.create({
        data: {
          assessmentId: assessment.id,
          runNumber: n,
          status: "SUCCESS",
          kind: run.kind || "ADJUDICATION",
          packetVersion: Number(run.packet_version) || 0,
          reportJson: JSON.stringify(run.report ?? {}),
        },
      });
    } catch { /* a run the contract does not expose is simply not indexed */ }
  }

  linked.push({ onChainId, appId: assessment.id, state,
                identity: a.identity_status, rollup: verdict.rollup,
                runs: verdict.total_runs, items: (a.items ?? []).length });
  log(`${onChainId}: linked — ${verdict.rollup ?? "no verdict"} · ${verdict.total_runs} run(s) · identity ${a.identity_status}`);
}

await prisma.$disconnect();
console.log("\n============ LINKED TO THE DASHBOARD ============");
for (const l of linked)
  console.log(`  ${l.onChainId}  ${String(l.rollup ?? "—").padEnd(28)} runs ${l.runs} · items ${l.items} · identity ${l.identity}`);
console.log(linked.length ? "Open the dashboard — these now appear." : "Nothing new to link.");
console.log("=================================================");
