/**
 * One address in every surface (S37).
 *
 *   node scripts/verify.mjs
 *
 * The deployment of record is named in the app's default, in the env example
 * a deployment copies, and in the README a reader checks against the
 * explorer. Three copies can drift into three different contracts without
 * anything failing, so this reads each and fails unless they agree.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const ADDRESS = /0x[0-9a-fA-F]{40}/;

const surfaces = {
  "web/lib/config.ts (DEPLOYMENT_OF_RECORD)": read("../lib/config.ts").match(/DEPLOYMENT_OF_RECORD = "(0x[0-9a-fA-F]{40})"/)?.[1],
  "web/.env.example": read("../.env.example").match(/NEXT_PUBLIC_CONTRACT_ADDRESS=(0x[0-9a-fA-F]{40})/)?.[1],
  "README.md (deployment of record)": read("../../README.md").match(new RegExp(`deployment of record[^\\n]*?(${ADDRESS.source})`, "i"))?.[1],
};

let failed = false;
const expected = surfaces["web/lib/config.ts (DEPLOYMENT_OF_RECORD)"];
for (const [where, value] of Object.entries(surfaces)) {
  const ok = Boolean(value) && value.toLowerCase() === String(expected).toLowerCase();
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} ${where}: ${value ?? "no address found"}`);
}
if (failed) {
  console.error("The surfaces name different contracts. Fix them before shipping.");
  process.exit(1);
}
console.log(`One address everywhere: ${expected}`);
