/**
 * What the live proofs share: fresh funded wallets, and every write a party
 * makes, driven through the SAME modules the browser runs (extraction,
 * hashing, the independent-source fingerprint, the manifest root, the
 * attestation, the write lifecycle). One more thing the app never does on
 * purpose lives here too: sending a write WITHOUT simulating it first, so
 * that a refusal has to come from the contract on chain, not from the app.
 */
import { createAccount, createClient } from "genlayer-js";
import { expect } from "vitest";

import { attestationMessage } from "../../lib/attest";
import { STUDIO_NEXT } from "../../lib/chain";
import { CONTRACT_ADDRESS, GENLAYER_RPC_URL } from "../../lib/config";
import { renderedText } from "../../lib/evidence/anchor";
import { extractEvidence } from "../../lib/evidence/extract";
import { sha256Bytes, sha256Text } from "../../lib/evidence/hash";
import { EXTRACTOR_VERSION } from "../../lib/evidence/normalize";
import { getBalanceAtto, requestTestGen } from "../../lib/faucet";
import { anchorItemJson, manifestRoot, nextEvidenceId, uploadedItemJson, type ObservationRow } from "../../lib/packet";
import { getRecord, getRecordIds, getStats, normalizeTxView } from "../../lib/read";
import { floorFee, writeAndConfirm, type TxProgress } from "../../lib/tx";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const LIVE = Boolean(process.env.AUTOCOURT_LIVE);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function logger(tag: string) {
  return (s: string) => console.log(`[${tag} ${new Date().toISOString().slice(11, 19)}] ${s}`);
}

export interface Wallet {
  name: string;
  address: string;
  account: any;
  client: any;
}

/** Every transaction hash a proof sends, by step, for the docs to cite. */
export class Receipts {
  readonly hashes: Record<string, string> = {};
  constructor(private readonly log: (s: string) => void) {}
  track(step: string) {
    return (p: TxProgress) => {
      if (p.hash) this.hashes[step] = p.hash;
      if (["accepted", "confirmed", "failed", "rejected", "unresolved"].includes(p.stage)) this.log(`${step}: ${p.stage} · ${p.detail}`);
    };
  }
}

/** A fresh wallet holding test GEN from the faucet the wallet menu offers. */
export async function fundedWallet(name: string, log: (s: string) => void): Promise<Wallet> {
  const account = createAccount();
  const client = createClient({ chain: { ...STUDIO_NEXT }, account });
  await requestTestGen(account.address);
  for (let i = 0; i < 20 && (await getBalanceAtto(account.address)) === 0n; i++) await sleep(2_000);
  expect(await getBalanceAtto(account.address)).toBeGreaterThan(0n);
  log(`${name} ${account.address}`);
  return { name, address: account.address.toLowerCase(), account, client };
}

export async function openRecord(
  w: Wallet,
  vehicle: { vin: string; make: string; model: string; year: number },
  claims: { type: string; declared_value: string }[],
  receipts: Receipts,
): Promise<string> {
  const before = (await getStats(true)).assessments;
  let id = "";
  await writeAndConfirm({
    client: w.client,
    address: CONTRACT_ADDRESS,
    functionName: "create_assessment",
    args: [JSON.stringify({ ...vehicle, seller_account: w.address }), JSON.stringify(claims)],
    simulate: false,
    predicateTries: 40,
    predicate: async () => {
      const now = (await getStats(true)).assessments;
      if (now <= before) return false;
      for (const candidate of await getRecordIds(before, now - before, true)) {
        const r = await getRecord(candidate, true);
        if (r?.seller_account === w.address && r.vin === vehicle.vin) id = candidate;
      }
      return Boolean(id);
    },
    onProgress: receipts.track("create"),
  });
  return id;
}

/** An uploaded document, extracted, fingerprinted and signed as the upload card does. */
export async function upload(
  w: Wallet,
  id: string,
  doc: { declared_class: string; label: string; text: string; observations?: ObservationRow[]; capture_date?: string },
  receipts: Receipts,
  step: string,
  appeal = false,
): Promise<string> {
  const record = (await getRecord(id, true))!;
  const bytes = new TextEncoder().encode(doc.text);
  const extraction = await extractEvidence(bytes);
  const text = extraction.normalizedText;
  const evidenceId = nextEvidenceId(record.items);
  const fileSha256 = await sha256Bytes(bytes);
  const textSha256 = await sha256Text(text);
  const signature = await w.account.signMessage({ message: attestationMessage({ evidenceId, textSha256, fileSha256 }) });
  await writeAndConfirm({
    client: w.client,
    address: CONTRACT_ADDRESS,
    functionName: appeal ? "submit_appeal_evidence" : "submit_evidence_text",
    args: [
      id,
      uploadedItemJson({
        evidence_id: evidenceId,
        declared_class: doc.declared_class,
        declared_label: doc.label,
        uploader_account: w.address,
        uploader_role: w.address === record.seller_account ? "SELLER" : "BUYER",
        file_sha256: fileSha256,
        text_sha256: textSha256,
        extractor_version: EXTRACTOR_VERSION,
        status: "EXTRACTED",
        text,
        uploader_signature: signature,
        observations: doc.observations ?? [],
        diagnostic_codes: [],
        capture_date: doc.capture_date ?? "",
      }),
    ],
    predicate: async () => Boolean((await getRecord(id, true))?.items.some((i) => i.evidence_id === evidenceId)),
    onProgress: receipts.track(step),
  });
  return evidenceId;
}

/** An independent source, fingerprinted over what the validators' browser renders. */
export async function addSource(w: Wallet, id: string, url: string, label: string, receipts: Receipts, step: string) {
  const served = await (await fetch(url, { cache: "no-store" })).text();
  const rendered = renderedText(served);
  const expected = await sha256Text(rendered);
  const evidenceId = nextEvidenceId((await getRecord(id, true))!.items);
  await writeAndConfirm({
    client: w.client,
    address: CONTRACT_ADDRESS,
    functionName: "submit_anchor_item",
    args: [id, anchorItemJson({ evidence_id: evidenceId, declared_label: label, url, expected_sha256: expected })],
    simulate: false,
    predicateTries: 40,
    predicate: async () => Boolean((await getRecord(id, true))?.items.some((i) => i.evidence_id === evidenceId)),
    onProgress: receipts.track(step),
  });
  return { evidenceId, expected, rendered, servedChars: served.length };
}

export async function dispute(w: Wallet, id: string, claimIds: string[], note: string, receipts: Receipts, step: string) {
  const before = (await getRecord(id, true))!.disputes.length;
  await writeAndConfirm({
    client: w.client,
    address: CONTRACT_ADDRESS,
    functionName: "record_dispute",
    args: [id, w.address, JSON.stringify(claimIds), note],
    predicate: async () => ((await getRecord(id, true))?.disputes.length ?? 0) > before,
    onProgress: receipts.track(step),
  });
}

export async function seal(w: Wallet, id: string, receipts: Receipts, step = "seal") {
  const record = (await getRecord(id, true))!;
  const root = await manifestRoot(
    record.items.map((i) => ({ evidenceId: i.evidence_id, fileSha256: i.file_sha256, textSha256: i.text_sha256, extractorVersion: i.extractor_version })),
  );
  await writeAndConfirm({
    client: w.client,
    address: CONTRACT_ADDRESS,
    functionName: "submit_assessment",
    args: [id, root],
    predicate: async () => (await getRecord(id, true))?.state === "SEALED",
    onProgress: receipts.track(step),
  });
  return root;
}

export async function adjudicate(w: Wallet, id: string, receipts: Receipts, step = "adjudicate") {
  const before = (await getRecord(id, true))!.runs_count;
  await writeAndConfirm({
    client: w.client,
    address: CONTRACT_ADDRESS,
    functionName: "adjudicate",
    args: [id],
    simulate: false,
    predicateTries: 100,
    predicate: async () => ((await getRecord(id, true))?.runs_count ?? 0) > before,
    onProgress: receipts.track(step),
  });
}

export async function appeal(w: Wallet, id: string, grounds: string, receipts: Receipts, step = "appeal") {
  const before = (await getRecord(id, true))!.runs_count;
  await writeAndConfirm({
    client: w.client,
    address: CONTRACT_ADDRESS,
    functionName: "readjudicate",
    args: [id, w.address, grounds],
    simulate: false,
    predicateTries: 100,
    predicate: async () => ((await getRecord(id, true))?.runs_count ?? 0) > before,
    onProgress: receipts.track(step),
  });
}

// ── refusals ────────────────────────────────────────────────────────────────

/** One raw JSON-RPC call, patient with the per-IP rate limit and a dropped connection. */
async function rpc(method: string, params: unknown[]): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(GENLAYER_RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const body = (await res.json()) as { result?: unknown; error?: { code?: number; message?: string } };
      if (body.error && (res.status === 429 || body.error.code === -32029) && attempt < 8) {
        await sleep(8_000);
        continue;
      }
      if (body.error) throw new Error(`${method}: ${body.error.message}`);
      return body.result;
    } catch (err) {
      if (attempt >= 8 || String(err).includes(`${method}:`)) throw err;
      await sleep(5_000);
    }
  }
}

/** Every string inside a receipt, and every string that base64 hides. */
function strings(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 6 || node === null || node === undefined) return out;
  if (typeof node === "string") {
    out.push(node);
    if (/^[A-Za-z0-9+/=]{8,}$/.test(node)) {
      try {
        out.push(Buffer.from(node, "base64").toString("utf8"));
      } catch {
        // Not base64 after all.
      }
    }
  } else if (Array.isArray(node)) {
    for (const v of node) strings(v, out, depth + 1);
  } else if (typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) strings(v, out, depth + 1);
  }
  return out;
}

/** The contract's own sentence in the deciding (leader) receipt of a finalized transaction. */
export function refusalSentence(tx: any): string {
  const rows: any[] = tx?.consensus_data?.leader_receipt ?? [];
  const leader = rows.find((r) => r?.mode !== "validator") ?? rows[0];
  for (const s of strings(leader)) {
    const at = s.indexOf("[EXPECTED]");
    // A traceback quotes the sentence as UserError('...'): keep the sentence only.
    if (at >= 0) return s.slice(at).split("\n")[0]!.replace(/['")\]}]+$/, "").trim();
  }
  return "";
}

/**
 * Send a write the way no honest client would: priced with the plain
 * estimate and never simulated, so nothing stops it before the chain. The
 * contract has to refuse it itself. Resolves once the transaction is
 * FINALIZED, with the leader's deciding sentence.
 */
export async function refusedOnChain(w: Wallet, functionName: string, args: unknown[], log: (s: string) => void) {
  const est = await w.client.estimateTransactionFees();
  const res = await w.client.writeContract({
    address: CONTRACT_ADDRESS as `0x${string}`,
    functionName,
    args,
    value: 0n,
    fees: { distribution: est.distribution, feeValue: floorFee(BigInt(est.feeValue)) },
  });
  const hash: string = typeof res === "string" ? res : (res?.transactionHash ?? res?.hash ?? "");
  expect(hash).toMatch(/^0x[0-9a-f]{64}$/i);
  for (let i = 0; i < 60; i++) {
    await sleep(10_000);
    const tx = await rpc("eth_getTransactionByHash", [hash]);
    const view = normalizeTxView(tx);
    if (view.finalized) {
      const sentence = refusalSentence(tx);
      log(`${functionName} by ${w.name}: FINALIZED · leader ${view.executed} · ${sentence || "(no sentence found)"} · ${hash}`);
      if (!sentence) log(`receipt keys: ${JSON.stringify(Object.keys(tx?.consensus_data?.leader_receipt?.[0] ?? {}))}`);
      return { hash, executed: view.executed, sentence };
    }
  }
  throw new Error(`${functionName} (${hash}) did not finalize in ten minutes`);
}

/** What the app does with the same write: simulate it, and send nothing if the contract refuses. */
export async function refusedBeforeSending(w: Wallet, functionName: string, args: unknown[]) {
  const stages: TxProgress[] = [];
  let thrown: unknown = null;
  try {
    await writeAndConfirm({
      client: w.client,
      address: CONTRACT_ADDRESS,
      functionName,
      args,
      predicate: async () => false,
      onProgress: (p) => stages.push(p),
    });
  } catch (err) {
    thrown = err;
  }
  const last = stages[stages.length - 1]!;
  return { thrown, last, sent: stages.some((p) => Boolean(p.hash)) };
}
