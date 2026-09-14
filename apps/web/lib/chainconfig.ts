import { chain } from "./chain.js";

/**
 * The contract's own bounds, cached per deployment.
 *
 * get_config() returns module constants, so its answer is fixed for a
 * given contract address — read once and kept. A FAILED read is never
 * cached: the next caller retries rather than inheriting a hiccup.
 */
let cached: { address: string; config: Record<string, unknown> } | null = null;

export async function chainConfig(): Promise<Record<string, unknown>> {
  const address = chain().address;
  if (cached && cached.address === address) return cached.config;
  const config = await chain().getConfig();
  cached = { address, config };
  return config;
}

/**
 * One of the contract's published numeric limits.
 *
 * Returns null when the contract could not be reached, or when the value
 * is not a sane positive integer. Callers must read null as "unknown" —
 * never as unlimited, and never as the number they happen to remember.
 * Restating a contract constant in the app is exactly how a UI starts
 * lying after a redeploy changes it, so each limit has one source.
 */
export async function contractLimit(key: string): Promise<number | null> {
  try {
    const value = (await chainConfig())[key];
    return typeof value === "number" && Number.isInteger(value) && value > 0
      ? value
      : null;
  } catch {
    return null;
  }
}

/** How many runs the contract allows on one assessment. */
export const maxRunsPerAssessment = (): Promise<number | null> =>
  contractLimit("max_runs_per_assessment");

/** How many new evidence items one appeal may carry. */
export const maxNewItemsPerAppeal = (): Promise<number | null> =>
  contractLimit("max_new_items_per_appeal");
