/**
 * A fast, chain-free check that the run limit reaches the screen from
 * the contract rather than from memory.
 *
 *   node scripts/check-maxruns.mjs
 *
 * Prints an assessment URL so the page itself can be looked at.
 */
import { Actor, BASE } from "./lib/harness.mjs";

const { config } = await (await fetch(`${BASE}/api/config`)).json();
const seller = await new Actor("MaxRuns Check").signIn();
const vehicle = await seller.api("/api/vehicles", {
  method: "POST",
  body: JSON.stringify({
    vin: "1HGCM82633A004352", make: "Honda", model: "Accord", year: 2003,
    claims: [{ type: "CONDITION", declaredValue: "checking the run limit" }],
  }),
});
const a = await seller.api("/api/assessments", {
  method: "POST", body: JSON.stringify({ vehicleId: vehicle.id }),
});
const detail = await seller.api(`/api/assessments/${a.id}`);

console.log(`contract get_config().max_runs_per_assessment = ${config.max_runs_per_assessment}`);
console.log(`detail payload maxRuns                        = ${detail.maxRuns}`);
console.log(detail.maxRuns === config.max_runs_per_assessment
  ? "MATCH — the screen is served the contract's own number"
  : "MISMATCH — the app is not reading the contract");
console.log(`\npage:   ${BASE}/assessments/${a.id}`);
console.log(`cookie: ${seller.cookie}`);
process.exit(detail.maxRuns === config.max_runs_per_assessment ? 0 : 1);
