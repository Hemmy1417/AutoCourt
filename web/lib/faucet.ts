/**
 * Test GEN for the connected wallet, so anyone can try AutoCourt without
 * leaving the page. Studio Next is a test network: its `sim_fundAccount`
 * RPC credits an address, and measured from a browser-shaped call (14 Sep)
 * a fresh address held the credit about two seconds later. Balances are
 * read with eth_getBalance, which sits in the RPC's roomy read bucket rather
 * than the 30-per-minute bucket contract reads share.
 */
import { GENLAYER_RPC_URL } from "./config";

/** One click's worth: enough for every write a full record needs, several times over. */
export const TEST_GEN_ATTO = 5n * 10n ** 18n;

/** Below this, a panel round's fee deposit may not fit. */
export const LOW_BALANCE_ATTO = 5n * 10n ** 17n;

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(GENLAYER_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json().catch(() => null)) as { result?: unknown; error?: { message?: string } } | null;
  if (!body) throw new Error(`Studio Next answered HTTP ${res.status} with no JSON body.`);
  if (body.error) throw new Error(body.error.message || "Studio Next refused the request.");
  return body.result;
}

export async function getBalanceAtto(address: string): Promise<bigint> {
  const result = await rpc("eth_getBalance", [address, "latest"]);
  return BigInt(String(result ?? "0x0"));
}

/** Credit the address with test GEN; resolves with the funding transaction's hash. */
export async function requestTestGen(address: string, amountAtto: bigint = TEST_GEN_ATTO): Promise<string> {
  // A JSON number carries this amount exactly (5 × 10^18 is a double without rounding).
  return String(await rpc("sim_fundAccount", [address, Number(amountAtto)]));
}
