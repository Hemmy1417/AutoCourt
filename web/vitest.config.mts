import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      // Pinned so a developer's shell cannot move the chain under the tests
      // that assert where each call goes.
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0xE26B3C4A36EC1a83Aa4814a9CA44e4b6a7EB7998",
      NEXT_PUBLIC_GENLAYER_RPC_URL: "https://studio-next.genlayer.com/api",
      NEXT_PUBLIC_GENLAYER_CHAIN_ID: "61997",
      NEXT_PUBLIC_GENLAYER_EXPLORER_URL: "https://explorer-studio-dev.genlayer.com",
    },
  },
});
