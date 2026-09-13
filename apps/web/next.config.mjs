import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// One .env at the MONOREPO ROOT serves web, worker and scripts alike —
// but Next only reads env files from its own app directory, so load the
// root file here (config is evaluated at server start, dev and prod).
// Only UNSET keys are filled: a deployment's real environment always wins.
try {
  const rootEnv = readFileSync(
    fileURLToPath(new URL("../../.env", import.meta.url)),
    "utf8",
  );
  for (const line of rootEnv.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && m[1] && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // No root .env (e.g. Vercel) — the platform provides the environment.
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@autocourt/shared-types",
    "@autocourt/validation",
    "@autocourt/evidence",
    "@autocourt/genlayer-client",
    "@autocourt/worker-core",
    "@autocourt/db",
  ],
  serverExternalPackages: ["@prisma/client"],
  // The monorepo root — a stray lockfile in the user profile otherwise
  // makes Next infer the wrong workspace root.
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  webpack: (config) => {
    // The repo uses node16-style ESM imports (./x.js resolving to x.ts);
    // teach webpack the same mapping tsc and vitest already use.
    config.resolve.extensionAlias = {
      ".js": [".js", ".ts", ".tsx"],
    };
    return config;
  },
};

export default nextConfig;
