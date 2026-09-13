import { defineConfig } from "@playwright/test";

/**
 * The seller-to-buyer journey against a real server + real Postgres
 * (CI's service container; any DATABASE_URL locally). The chain boundary
 * is the job queue: the journey asserts everything up to and including
 * the enqueue, and the live arc (scripts/arc.mjs) proves the chain half
 * on the deployment of record.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3100",
  },
  webServer: {
    command: "npx next start apps/web -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-secret-0123456789",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://autocourt:autocourt_dev@localhost:5432/autocourt",
      EVIDENCE_ROOT: "var/e2e-evidence",
      NODE_ENV: "production",
    },
  },
});
