import { AutoCourtChain } from "@autocourt/genlayer-client";

let cached: AutoCourtChain | null = null;

export function chain(): AutoCourtChain {
  if (cached) return cached;
  const rpcUrl = process.env.GENLAYER_RPC_URL ?? "https://studio-next.genlayer.com/api";
  const contractAddress = process.env.GENLAYER_CONTRACT_ADDRESS ?? "";
  const privateKey = process.env.GENLAYER_OPERATOR_PK ?? "";
  if (!contractAddress || !privateKey) {
    throw new Error(
      "GENLAYER_CONTRACT_ADDRESS and GENLAYER_OPERATOR_PK must be set",
    );
  }
  cached = new AutoCourtChain({ rpcUrl, contractAddress, privateKey });
  return cached;
}
