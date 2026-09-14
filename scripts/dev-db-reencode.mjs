/**
 * Re-create the local development cluster as UTF-8, keeping every row.
 *
 *   node scripts/dev-db-reencode.mjs        (stop dev-db, the app and the worker first)
 *
 * WHY THIS EXISTS. initdb takes its encoding from the machine unless told
 * otherwise, and on Windows that is the ANSI code page: the cluster
 * dev-db.mjs created here was WIN1252, every database in it included.
 * WIN1252 has no room for most of the world's text. It surfaced when a
 * panel's verdict carried a non-breaking hyphen (U+2011): the worker could
 * not cache it, failed on every pass, and ac-000020 sat at PROCESSING with
 * its verdict already on chain. A seller's name in Greek, a note in
 * Japanese, an emoji in a dispute would have failed the same way.
 *
 * WHAT IT DOES. Keeps the old cluster untouched, renamed beside the new
 * one; initializes a UTF-8 cluster where dev-db expects it; applies the
 * migrations; copies every row of every database, parents before
 * children, as text so no value passes through a JavaScript type on the
 * way; and verifies the row count of every table on both sides. It never
 * deletes anything. A cluster that is already UTF-8 is left alone.
 */
import EmbeddedPostgres from "embedded-postgres";
import { execSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DATA_DIR = fileURLToPath(new URL("../var/pg", import.meta.url));
const PORT = 5455;
const OLD_PORT = 5456;
const USER = "autocourt";
const PASSWORD = "autocourt_dev";
const MIGRATE = "npx prisma migrate deploy --schema packages/db/prisma/schema.prisma";
const RAW = { getTypeParser: () => (value) => value };

const log = (s) => console.log(`[reencode] ${s}`);
const listening = (port) =>
  new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });

if (await listening(PORT)) {
  console.error(`[reencode] something is serving :${PORT} — stop dev-db, the app and the worker first`);
  process.exit(2);
}
if (!existsSync(DATA_DIR)) {
  log("no cluster at var/pg — dev-db.mjs will create a UTF-8 one");
  process.exit(0);
}

const cluster = (databaseDir, port, extra = {}) =>
  new EmbeddedPostgres({ databaseDir, user: USER, password: PASSWORD, port, persistent: true, ...extra });

// ── 1. what is there now ────────────────────────────────────────────────────
let old = cluster(DATA_DIR, OLD_PORT);
await old.start();
const probe = old.getPgClient("postgres");
await probe.connect();
const encoding = (await probe.query("SHOW server_encoding")).rows[0].server_encoding;
const databases = (await probe.query(
  "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres' ORDER BY datname",
)).rows.map((r) => r.datname);
await probe.end();
await old.stop();
if (encoding === "UTF8") {
  log("the cluster is already UTF-8 — nothing to do");
  process.exit(0);
}
log(`cluster is ${encoding}; databases: ${databases.join(", ")}`);

// ── 2. keep the old cluster, untouched, beside the new one ─────────────────
const backup = `${DATA_DIR}-${encoding.toLowerCase()}-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}`;
renameSync(DATA_DIR, backup);
log(`old cluster kept at ${backup}`);
old = cluster(backup, OLD_PORT);
await old.start();

// ── 3. a UTF-8 cluster where dev-db expects one ─────────────────────────────
const fresh = cluster(DATA_DIR, PORT, { initdbFlags: ["--encoding=UTF8", "--locale=C"] });
await fresh.initialise();
await fresh.start();

const failures = [];
try {
  for (const name of databases) {
    await fresh.createDatabase(name);
    execSync(MIGRATE, {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${name}` },
      stdio: "pipe",
    });

    const src = old.getPgClient(name);
    const dst = fresh.getPgClient(name);
    await src.connect();
    await dst.connect();

    // Parents before children, from the schema's own foreign keys.
    const tables = (await src.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
    )).rows.map((r) => r.tablename);
    const parents = new Map(tables.map((t) => [t, new Set()]));
    for (const { child, parent } of (await src.query(`
      SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent
      FROM pg_constraint WHERE contype = 'f'`)).rows) {
      const c = child.replace(/"/g, ""), p = parent.replace(/"/g, "");
      if (c !== p && parents.has(c)) parents.get(c).add(p);
    }
    const order = [];
    while (order.length < tables.length) {
      const ready = tables.filter((t) => !order.includes(t) && [...parents.get(t)].every((p) => order.includes(p)));
      if (ready.length === 0) throw new Error(`foreign keys form a cycle among: ${tables.filter((t) => !order.includes(t))}`);
      order.push(...ready.sort());
    }

    await dst.query("BEGIN");
    const copied = [];
    for (const table of order) {
      const { rows, fields } = await src.query({ text: `SELECT * FROM "${table}"`, types: RAW });
      const columns = fields.map((f) => `"${f.name}"`).join(", ");
      const params = fields.map((_, i) => `$${i + 1}`).join(", ");
      for (const row of rows) {
        await dst.query(`INSERT INTO "${table}" (${columns}) VALUES (${params})`, fields.map((f) => row[f.name]));
      }
      copied.push([table, rows.length]);
    }
    await dst.query("COMMIT");

    for (const [table, expected] of copied) {
      const got = Number((await dst.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n);
      if (got !== expected) failures.push(`${name}.${table}: copied ${got} of ${expected}`);
    }
    const stored = (await dst.query("SELECT $1::text AS s", ["long‑standing · 検査 · ✓"])).rows[0].s;
    if (stored !== "long‑standing · 検査 · ✓") failures.push(`${name}: UTF-8 did not round-trip`);
    log(`${name}: ${copied.map(([t, n]) => `${t} ${n}`).join(" · ")}`);
    await src.end();
    await dst.end();
  }
} finally {
  await fresh.stop();
  await old.stop();
}

if (failures.length) {
  console.error(`[reencode] INCOMPLETE — ${failures.join("; ")}`);
  console.error(`[reencode] the original cluster is intact at ${backup}`);
  process.exit(1);
}
log(`done — var/pg is UTF-8 with every row; the ${encoding} original is at ${backup}`);
log("start the database again with: node scripts/dev-db.mjs");
