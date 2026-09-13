/**
 * Local job mover: calls the web app's authenticated drain route on a
 * fixed cadence — the same function the production cron hits, so local
 * behavior and deployed behavior are one code path (S26: the mover is
 * named in every deployment shape; locally it is this loop).
 *
 *   node scripts/dev-drain.mjs        (leave running beside dev-db)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envText = readFileSync(
  fileURLToPath(new URL("../.env", import.meta.url)),
  "utf8",
);
const env = Object.fromEntries(
  envText
    .split("\n")
    .map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);
const BASE = process.env.AUTOCOURT_URL ?? "http://localhost:3108";
const INTERVAL = Number(env.WORKER_INTERVAL_MS ?? 15_000);

console.log(`[dev-drain] driving ${BASE}/api/jobs/drain every ${INTERVAL}ms`);
for (;;) {
  try {
    const res = await fetch(`${BASE}/api/jobs/drain`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.DRAIN_TOKEN}` },
    });
    const j = await res.json();
    if (res.ok && (j.drained > 0 || j.effects?.runsRecorded > 0)) {
      console.log(
        `[dev-drain] drained=${j.drained} ok=${j.succeeded} failed=${j.failed} ` +
          `linked=${j.effects?.linked ?? 0} runs=${j.effects?.runsRecorded ?? 0}`,
      );
    } else if (!res.ok) {
      console.error(`[dev-drain] ${res.status}: ${JSON.stringify(j).slice(0, 120)}`);
    }
  } catch (e) {
    console.error(`[dev-drain] ${String(e?.message ?? e).slice(0, 120)}`);
  }
  await new Promise((r) => setTimeout(r, INTERVAL));
}
