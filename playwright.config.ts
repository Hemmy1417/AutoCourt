import { defineConfig } from "@playwright/test";

/**
 * The seller-to-buyer journey against a real server + real Postgres
 * (CI's service container; the embedded cluster's `autocourt_e2e`
 * database locally — ISOLATED from the dev book on purpose: the local
 * dev-drain loop ships the dev database's job queue to the live chain,
 * and journey fixtures must never ride it). The chain boundary is the
 * job queue: the journey asserts everything up to and including the
 * enqueue; scripts/arc.mjs proves the chain half on the deployment of
 * record, and the drain pipeline is proven by the seam pass in
 * docs/PROBE-REPORT.md.
 *
 * Local run:  npx playwright test        (defaults to autocourt_e2e@5455)
 * CI run:     DATABASE_URL points at the service container.
 */
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://autocourt:autocourt_dev@localhost:5455/autocourt_e2e";

// Pinned for the test workers, which inherit this environment. A spec that
// imports @prisma/client has the root .env loaded into its process — so
// without this it resolves the DEV database, seeds its record there, and
// the server under test (on this one) answers "not found" for it.
process.env.E2E_DATABASE_URL = E2E_DATABASE_URL;

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
      DATABASE_URL: E2E_DATABASE_URL,
      EVIDENCE_ROOT: "var/e2e-evidence",
      NODE_ENV: "production",
    },
  },
});
