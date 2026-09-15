import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      // Pinned so a developer's shell cannot move the chain under the tests
      // that assert where each call goes. AUTOCOURT_CONTRACT exists for one
      // purpose: pointing the live proofs at a disposable deployment before
      // a change is deployed for real.
      NEXT_PUBLIC_CONTRACT_ADDRESS: process.env.AUTOCOURT_CONTRACT || "0xa59D87e6ECdde32e940Ae060D146FcB85F9F7dE3",
      NEXT_PUBLIC_GENLAYER_RPC_URL: "https://studio-next.genlayer.com/api",
      NEXT_PUBLIC_GENLAYER_CHAIN_ID: "61997",
      NEXT_PUBLIC_GENLAYER_EXPLORER_URL: "https://explorer-studio-dev.genlayer.com",
    },
  },
});
