/**
 * The long-lived job mover: drain, record effects, sleep, repeat.
 * Serverless deployments use a platform cron hitting /api/jobs/drain
 * instead — same functions, same lease, same behavior (S26: the mover is
 * named in both deployment shapes).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The repo-root .env, the same file next.config.mjs loads for the web
// app. Without it the worker starts with no DATABASE_URL and no operator
// key and fails on its first pass. Only UNSET keys are filled, so a
// deployment's real environment always wins.
try {
  const rootEnv = readFileSync(
    fileURLToPath(new URL("../../../.env", import.meta.url)),
    "utf8",
  );
  for (const line of rootEnv.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    const key = m?.[1];
    const value = m?.[2];
    if (key && value !== undefined && process.env[key] === undefined) {
      process.env[key] = value.replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // No root .env (a real deployment) — the platform provides it.
}

/**
 * Load the COMPILED packages explicitly.
 *
 * Every workspace package points `main` at its TypeScript source, which
 * suits Next (it transpiles them) and vitest, but plain Node cannot load
 * a .ts file — so a bare `import "@autocourt/worker-core"` here dies with
 * ERR_UNKNOWN_FILE_EXTENSION. Rather than repoint every package's main
 * and risk the web build, the one consumer that runs on bare Node says
 * where the built files are. The `typeof import(...)` casts keep full
 * type checking against the source.
 */
const dist = (p: string) =>
  new URL(`../../../packages/${p}/dist/index.js`, import.meta.url).href;

const { AutoCourtChain } = (await import(
  dist("genlayer-client")
)) as typeof import("@autocourt/genlayer-client");
const { recordJobEffects, runPendingJobs } = (await import(
  dist("worker-core")
)) as typeof import("@autocourt/worker-core");

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 15_000);

const chain = new AutoCourtChain({
  rpcUrl: process.env.GENLAYER_RPC_URL ?? "https://studio-next.genlayer.com/api",
  contractAddress: process.env.GENLAYER_CONTRACT_ADDRESS ?? "",
  privateKey: process.env.GENLAYER_OPERATOR_PK ?? "",
});

console.log(
  `[worker] draining as ${chain.account.address} against ${chain.address}`,
);

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});

while (!stopping) {
  try {
    const drained = await runPendingJobs({ chain });
    const effects = await recordJobEffects(chain);
    if (drained.drained > 0 || effects.runsRecorded > 0) {
      console.log(
        `[worker] drained=${drained.drained} ok=${drained.succeeded} ` +
          `failed=${drained.failed} pending=${drained.stillPending} ` +
          `linked=${effects.linked} runs=${effects.runsRecorded}`,
      );
    }
  } catch (e) {
    console.error("[worker] pass failed:", (e as Error)?.message ?? e);
  }
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
}
console.log("[worker] stopped");
