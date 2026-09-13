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
 * How many runs the CONTRACT allows on one assessment.
 *
 * Returns null when the contract could not be reached. Callers must read
 * null as "unknown" — never as unlimited, and never as a remembered 4.
 * Restating a contract constant in the app is exactly how a UI starts
 * lying after a redeploy changes it, so the number has one source.
 */
export async function maxRunsPerAssessment(): Promise<number | null> {
  try {
    const value = (await chainConfig())["max_runs_per_assessment"];
    return typeof value === "number" && Number.isInteger(value) && value > 0
      ? value
      : null;
  } catch {
    return null;
  }
}
