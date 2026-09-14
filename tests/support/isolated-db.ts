/**
 * A throwaway PostgreSQL schema, for tests that need the real database.
 *
 * The job queue is global: a drain pass picks up every PENDING row it can
 * see. Pointed at a database holding real work, a test driving the
 * drainer with a stub chain would "finish" real jobs with fake hashes. So
 * these tests never share a schema with anything — each file migrates a
 * fresh one before importing the client, and drops it afterwards.
 *
 * Runs only when DATABASE_URL is set. CI sets it; locally, pass it.
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const hasDatabase = Boolean(process.env.DATABASE_URL);

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Point DATABASE_URL at a new, fully migrated schema. Call it BEFORE the
 * first import of @autocourt/db — the client reads the URL when it is
 * constructed, and it is constructed once per process.
 */
export function isolateDatabase(label: string): string {
  const url = new URL(process.env.DATABASE_URL as string);
  const schema = `t_${label}_${process.pid}_${Date.now().toString(36)}`;
  url.searchParams.set("schema", schema);
  process.env.DATABASE_URL = url.toString();
  execSync(
    "npx prisma migrate deploy --schema packages/db/prisma/schema.prisma",
    { cwd: ROOT, env: process.env, stdio: "pipe" },
  );
  return schema;
}
