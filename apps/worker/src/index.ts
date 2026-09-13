/**
 * The long-lived job mover: drain, record effects, sleep, repeat.
 * Serverless deployments use a platform cron hitting /api/jobs/drain
 * instead — same functions, same lease, same behavior (S26: the mover is
 * named in both deployment shapes).
 */

import { AutoCourtChain } from "@autocourt/genlayer-client";
import { runPendingJobs } from "@autocourt/worker-core";

// The effects module lives in the web app's lib; the worker imports the
// same file so there is exactly one implementation of every DB effect.
import { recordJobEffects } from "../../web/lib/jobeffects.js";

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
