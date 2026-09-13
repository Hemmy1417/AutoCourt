/**
 * The one bridge between the app and the chain. Two disciplines are
 * enforced here and nowhere else:
 *
 *   SUBMIT ONCE, THEN POLL. Every write returns its tx hash before
 *   anything else happens; a crash between submit and record is
 *   recovered by re-reading the chain, never by resubmitting blind — a
 *   lost response is not a refusal.
 *
 *   ONE ATTEMPT PER WRITE. Estimation or send failure is reported, not
 *   retried here; the Job queue owns bounded retries, and each retry is
 *   a NEW attempt with its own recorded hash.
 */

import { createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";

export const DEFAULT_RPC = "https://studio-next.genlayer.com/api";
export const CHAIN_ID = 61997;
const FEE_FLOOR = 10n ** 15n;
const CALL_TIMEOUT_MS = 45_000;
const FINALITY_POLL_MS = 4_000;

export interface GenLayerConfig {
  rpcUrl: string;
  contractAddress: string;
  /** Hex private key for the operator's submitting wallet. */
  privateKey: string;
}

export interface WriteResult {
  txHash: string;
}

export interface TxStatus {
  status:
    | "PENDING"
    | "ACCEPTED"
    | "FINALIZED"
    | "CANCELED"
    | "UNDETERMINED"
    | "UNKNOWN";
  leaderResult?: string;
  /** The contract's own refusal sentence, when the leader errored. */
  refusalText?: string;
}

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${what}: no response in ${CALL_TIMEOUT_MS}ms`)),
        CALL_TIMEOUT_MS,
      ),
    ),
  ]);
}

export class AutoCourtChain {
  private readonly client: ReturnType<typeof createClient>;
  private readonly rpcUrl: string;
  readonly address: string;
  readonly account: { address: string };

  constructor(cfg: GenLayerConfig) {
    const chain = {
      ...studioDevnet,
      name: "GenLayer Studio Next",
      rpcUrls: { default: { http: [cfg.rpcUrl] } },
    } as typeof studioDevnet;
    const account = createAccount(cfg.privateKey as `0x${string}`);
    // genlayer-js 2.0.0-rc.1's GenLayerChain type disagrees with its own
    // createClient parameter under exactOptionalPropertyTypes; the value
    // is the library's own chain object, so the cast is sound.
    this.client = createClient({ chain, account } as Parameters<
      typeof createClient
    >[0]);
    this.rpcUrl = cfg.rpcUrl;
    this.address = cfg.contractAddress;
    this.account = { address: account.address };
  }

  private async rpc(method: string, params: unknown[]): Promise<any> {
    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0 autocourt-app",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return res.json();
  }

  /** ONE attempt. Returns the hash the caller must persist before waiting. */
  async write(functionName: string, args: unknown[]): Promise<WriteResult> {
    const est = await withTimeout(
      this.client.estimateTransactionFees(),
      `${functionName} estimate`,
    );
    const feeValue = est.feeValue > FEE_FLOOR ? est.feeValue : FEE_FLOOR;
    const txHash = await withTimeout(
      this.client.writeContract({
        address: this.address as `0x${string}`,
        functionName,
        args: args as never[],
        value: 0n,
        fees: { distribution: est.distribution, feeValue },
      }),
      `${functionName} send`,
    );
    return { txHash: String(txHash) };
  }

  /** Read a transaction's consensus status — the recovery primitive. */
  async txStatus(txHash: string): Promise<TxStatus> {
    const r = await this.rpc("eth_getTransactionByHash", [txHash]);
    const t = r.result;
    if (!t) return { status: "UNKNOWN" };
    const status = String(t.status ?? t.statusName ?? "PENDING");
    if (!["FINALIZED", "ACCEPTED", "CANCELED", "UNDETERMINED"].includes(status))
      return { status: "PENDING" };
    const arr = t.consensus_data?.leader_receipt ?? [];
    const leader =
      arr.find((x: any) => x?.mode !== "validator") ?? arr[0] ?? {};
    const out: TxStatus = {
      status: status as TxStatus["status"],
      leaderResult: leader?.execution_result,
    };
    if (leader?.execution_result && leader.execution_result !== "SUCCESS") {
      // The contract's refusal sentence lives in leader_receipt.result:
      // base64 whose decoded bytes are a control byte + the printable
      // UserError text. On this network `result` IS the base64 string
      // (older shapes wrap it as {payload}); stderr stays as a fallback.
      const r = leader?.result;
      const rawPayload = typeof r === "string" ? r : r?.payload;
      const RE = /\[(EXPECTED|EXTERNAL|TRANSIENT|LLM_ERROR)\][^\n"]*/;
      if (typeof rawPayload === "string") {
        try {
          const decoded = Buffer.from(rawPayload, "base64").toString("utf-8");
          const m = decoded.match(RE);
          if (m) out.refusalText = m[0];
        } catch {
          // fall through to stderr
        }
      }
      if (!out.refusalText) {
        const stderr = String(leader?.genvm_result?.stderr ?? "");
        const m = stderr.match(RE);
        if (m) out.refusalText = m[0];
      }
    }
    return out;
  }

  /**
   * Poll until a terminal status. "Finalized" is claimed only at
   * FINALIZED + leader SUCCESS; ACCEPTED is reported as ACCEPTED.
   */
  async waitFinality(
    txHash: string,
    maxTries = 90,
  ): Promise<TxStatus> {
    for (let i = 0; i < maxTries; i++) {
      await new Promise((r) => setTimeout(r, FINALITY_POLL_MS));
      const s = await this.txStatus(txHash);
      if (
        s.status === "FINALIZED" ||
        s.status === "CANCELED" ||
        s.status === "UNDETERMINED"
      )
        return s;
    }
    return { status: "PENDING" };
  }

  private async view<T>(functionName: string, args: unknown[]): Promise<T> {
    const raw = await withTimeout(
      this.client.readContract({
        address: this.address as `0x${string}`,
        functionName,
        args: args as never[],
      }),
      `view ${functionName}`,
    );
    return JSON.parse(String(raw)) as T;
  }

  // ── the contract surface, typed thinly (the app trusts get_config for
  //    every bound; nothing here re-declares a limit) ─────────────────────

  getConfig(): Promise<Record<string, unknown>> {
    return this.view("get_config", []);
  }

  getAssessment(id: string): Promise<Record<string, unknown>> {
    return this.view("get_assessment", [id]);
  }

  getVerdict(id: string): Promise<Record<string, unknown>> {
    return this.view("get_verdict", [id]);
  }

  getRun(id: string, n: number): Promise<Record<string, unknown>> {
    return this.view("get_run", [id, n]);
  }

  getManifest(id: string, version: number): Promise<Record<string, unknown>> {
    return this.view("get_manifest", [id, version]);
  }

  getItemText(id: string, evidenceId: string): Promise<Record<string, unknown>> {
    return this.view("get_item_text", [id, evidenceId]);
  }

  getStats(): Promise<Record<string, unknown>> {
    return this.view("get_stats", []);
  }

  createAssessment(vehicleJson: string, claimsJson: string): Promise<WriteResult> {
    return this.write("create_assessment", [vehicleJson, claimsJson]);
  }

  submitEvidenceText(id: string, itemJson: string): Promise<WriteResult> {
    return this.write("submit_evidence_text", [id, itemJson]);
  }

  submitAnchorItem(id: string, itemJson: string): Promise<WriteResult> {
    return this.write("submit_anchor_item", [id, itemJson]);
  }

  recordDispute(
    id: string,
    account: string,
    claimIdsJson: string,
    note: string,
  ): Promise<WriteResult> {
    return this.write("record_dispute", [id, account, claimIdsJson, note]);
  }

  sealAssessment(id: string, manifestRoot: string): Promise<WriteResult> {
    return this.write("submit_assessment", [id, manifestRoot]);
  }

  submitAppealEvidence(id: string, itemJson: string): Promise<WriteResult> {
    return this.write("submit_appeal_evidence", [id, itemJson]);
  }

  adjudicate(id: string): Promise<WriteResult> {
    return this.write("adjudicate", [id]);
  }

  readjudicate(
    id: string,
    appellantAccount: string,
    grounds: string,
  ): Promise<WriteResult> {
    return this.write("readjudicate", [id, appellantAccount, grounds]);
  }
}
