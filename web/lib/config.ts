/**
 * Build-time configuration. Every value compiles into the bundle, so a
 * deployment that changes one must rebuild.
 *
 * The contract address defaults to the deployment of record rather than to
 * nothing: a site built without the variable then still reads the record
 * every document in this repository names, instead of rendering an empty
 * shell. `npm run verify` checks that this default, web/.env.example and
 * the README all name the same address.
 */

export const DEPLOYMENT_OF_RECORD = "0xE26B3C4A36EC1a83Aa4814a9CA44e4b6a7EB7998";

export const CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || DEPLOYMENT_OF_RECORD
).trim();

export const CONTRACT_CONFIGURED = /^0x[0-9a-fA-F]{40}$/.test(CONTRACT_ADDRESS);

/** GenLayer Studio Next. See STUDIO_NEXT in lib/chain.ts for the wiring. */
export const GENLAYER_RPC_URL = (
  process.env.NEXT_PUBLIC_GENLAYER_RPC_URL || "https://studio-next.genlayer.com/api"
).trim();

export const GENLAYER_CHAIN_ID = Number(process.env.NEXT_PUBLIC_GENLAYER_CHAIN_ID || "61997");

/** The Studio Next explorer: serves `/address/<addr>` and `/tx/<hash>`. */
export const GENLAYER_EXPLORER_URL = (
  process.env.NEXT_PUBLIC_GENLAYER_EXPLORER_URL || "https://explorer-studio-dev.genlayer.com"
)
  .trim()
  .replace(/\/+$/, "");

export const explorerTx = (hash: string) => `${GENLAYER_EXPLORER_URL}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${GENLAYER_EXPLORER_URL}/address/${addr}`;

const ATTO = 10n ** 18n;

/** "0.100": GEN with three decimals, from atto. Display only. */
export function formatGen(atto: string | bigint, decimals = 3): string {
  let v: bigint;
  try {
    v = typeof atto === "bigint" ? atto : BigInt(String(atto || "0"));
  } catch {
    return "0";
  }
  const negative = v < 0n;
  if (negative) v = -v;
  const whole = v / ATTO;
  const frac = ((v % ATTO) * 10n ** BigInt(decimals)) / ATTO;
  const fracStr = frac.toString().padStart(decimals, "0");
  return `${negative ? "-" : ""}${whole.toString()}${decimals ? "." + fracStr : ""}`;
}
