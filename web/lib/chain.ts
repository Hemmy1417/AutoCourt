/**
 * Chain constants and pure helpers: no browser, no provider, fully testable.
 * The wallet and read layers build on these; nothing here touches a network.
 */
import { studioDevnet } from "genlayer-js/chains";

import { GENLAYER_CHAIN_ID, GENLAYER_EXPLORER_URL, GENLAYER_RPC_URL } from "./config";

export const CHAIN_ID = GENLAYER_CHAIN_ID;

/** EIP-695 hex chain id: lowercase, no leading zeros. 61997 -> "0xf22d". */
export function toChainHex(id: number): `0x${string}` {
  if (!Number.isInteger(id) || id <= 0) throw new Error(`bad chain id: ${id}`);
  return `0x${id.toString(16)}` as `0x${string}`;
}

export const CHAIN_HEX = toChainHex(CHAIN_ID);

/**
 * GenLayer Studio Next as a genlayer-js chain: the SDK's `studioDevnet`
 * (chain 61997, `isStudio: true`, which selects the sim_* fee path) with
 * the RPC swapped for Studio Next's. A clone, never the SDK's singleton:
 * createClient's `endpoint` option writes into whatever chain object it is
 * handed.
 *
 * Every read, fee estimate and status poll goes to this RPC straight from
 * the visitor's browser, and the wallet signs the writes. Studio Next
 * answers browser origins (it sends `access-control-allow-origin: *`, on
 * its rate-limit refusals too), and its limit is per IP: contract reads
 * share a 30-per-minute bucket. A server-side proxy would pool every
 * visitor into ONE budget, so this app deliberately has none; lib/read.ts
 * paces each tab under the limit instead.
 */
export const STUDIO_NEXT = {
  ...studioDevnet,
  id: CHAIN_ID,
  name: "GenLayer Studio Next",
  rpcUrls: { default: { http: [GENLAYER_RPC_URL] } },
  blockExplorers: {
    default: { name: "GenLayer Studio Next", url: GENLAYER_EXPLORER_URL },
  },
};

/** wallet_addEthereumChain params for GenLayer Studio Next. */
export const STUDIO_NEXT_PARAMS = {
  chainId: CHAIN_HEX,
  chainName: "GenLayer Studio Next",
  rpcUrls: [GENLAYER_RPC_URL],
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
} as const;

/**
 * Did the wallet just say "I have never heard of this chain"?
 *
 * EIP-3326 assigns that answer code 4902, but MetaMask nests it: measured
 * against Studio Next, a switch to an unknown chain rejects with code
 * -32603 and the 4902 under `data.originalError`. Checking the top-level
 * code alone let "Unrecognized chain ID" reach the user and the
 * add-network prompt never opened (measured 6 Sep). The code is looked for at
 * every level the major wallets use, and the message is the last resort.
 */
export function isUnknownChainError(err: unknown): boolean {
  const e = err as
    | {
        code?: unknown;
        message?: unknown;
        data?: { originalError?: { code?: unknown; message?: unknown }; code?: unknown };
        cause?: { code?: unknown; message?: unknown };
      }
    | undefined;
  const codes = [e?.code, e?.data?.originalError?.code, e?.data?.code, e?.cause?.code];
  if (codes.some((c) => c === 4902 || c === "4902")) return true;
  const text = [e?.message, e?.data?.originalError?.message, e?.cause?.message]
    .filter((m) => typeof m === "string")
    .join(" ");
  return /unrecognized chain|wallet_addEthereumChain|\b4902\b/i.test(text);
}

/** 0x1234ab…cdef: the display form of a connected identity. */
export function truncAddr(addr: string): string {
  return addr.length > 13 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

/**
 * Raw EIP-1193 errors, in words a person can act on. Anything unrecognised
 * keeps its own message rather than being flattened into a generic one.
 */
export function walletErrorMessage(err: unknown): string {
  const e = err as { code?: number; message?: string } | undefined;
  if (e?.code === 4001) return "You declined the request in your wallet. Nothing was sent.";
  if (e?.code === -32002)
    return "Your wallet already has a request open. Finish or dismiss it, then try again.";
  if (e?.code === 4902)
    return "GenLayer Studio Next is not in this wallet yet. Approve the prompt to add it.";
  if (e?.code === 4900 || e?.code === 4901)
    return "Your wallet is disconnected from the network. Reconnect and try again.";
  return e?.message ? e.message.slice(0, 160) : "The wallet call failed.";
}

/** Transient RPC noise that should be retried rather than surfaced. */
const TRANSIENT =
  /\[transient\]|rate limit|429|-32029|failed to fetch|fetch failed|networkerror|load failed|unreachable|doctype|not valid json|unexpected token|502|503|504|timeout|econnreset|socket|server busy|execution slots|retry later/i;

export function isTransient(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err ?? "");
  return TRANSIENT.test(msg);
}

/**
 * Do two addresses refer to the same account? The record stores accounts
 * lowercase, and viem's getAddress returns EIP-55 mixed case, so a raw
 * string comparison would hide the seller's own controls from the seller.
 * Every ownership check in the app goes through this.
 */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
