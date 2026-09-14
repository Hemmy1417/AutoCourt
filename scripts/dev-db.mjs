/**
 * Local development database — real PostgreSQL 16, no Docker, no admin
 * install: the binaries ship via the `embedded-postgres` dev dependency
 * and the cluster lives in var/pg (gitignored).
 *
 *   node scripts/dev-db.mjs         initialize (first run) and serve on :5455
 *
 * Matches DATABASE_URL in .env:
 *   postgresql://autocourt:autocourt_dev@localhost:5455/autocourt
 *
 * Deployed environments never use this — Vercel gets a hosted Postgres and
 * CI runs the postgres:16 service container; this exists so the full stack
 * runs on a machine with nothing installed.
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DATA_DIR = fileURLToPath(new URL("../var/pg", import.meta.url));
const PORT = 5455;

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "autocourt",
  password: "autocourt_dev",
  port: PORT,
  persistent: true,
  // Without these, initdb takes the machine's encoding — on Windows the
  // ANSI code page, which cannot store a non-breaking hyphen, let alone a
  // name in Greek. Hosted Postgres and CI's container are UTF-8 already.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

const fresh = !existsSync(DATA_DIR);
if (fresh) {
  console.log(`[dev-db] initializing a new cluster in var/pg …`);
  await pg.initialise();
}
await pg.start();
if (fresh) {
  await pg.createDatabase("autocourt");
  await pg.createDatabase("autocourt_e2e");
  console.log(`[dev-db] databases "autocourt" and "autocourt_e2e" created`);
}

// A cluster made before the flags above keeps its old encoding for ever.
// Serving it anyway is how a verdict once failed to record on every pass.
const check = pg.getPgClient("postgres");
await check.connect();
const { server_encoding: encoding } = (await check.query("SHOW server_encoding")).rows[0];
await check.end();
if (encoding !== "UTF8") {
  console.error(
    `[dev-db] REFUSING: this cluster is ${encoding}, not UTF-8, so it cannot store ` +
      "text outside that code page. Stop here and run:\n" +
      "  node scripts/dev-db-reencode.mjs\n" +
      "which rebuilds it as UTF-8, copies every row, and keeps the original.",
  );
  await pg.stop();
  process.exit(1);
}
console.log(
  `[dev-db] PostgreSQL 16 serving on localhost:${PORT} — leave this running; Ctrl+C stops it`,
);

async function stop() {
  console.log("\n[dev-db] stopping …");
  try {
    await pg.stop();
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
