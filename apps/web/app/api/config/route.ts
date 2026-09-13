import { chain } from "../../../lib/chain.js";
import { errorResponse } from "../../../lib/errors.js";

// Live chain read on every call — never prerendered at build.
export const dynamic = "force-dynamic";

/**
 * The contract's own bounds, proxied verbatim — the frontend never
 * guesses a limit the contract enforces.
 */
export async function GET(): Promise<Response> {
  try {
    const cfg = await chain().getConfig();
    return Response.json({
      contractAddress: chain().address,
      chainId: 61997,
      explorer: "https://explorer-studio-dev.genlayer.com",
      config: cfg,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
