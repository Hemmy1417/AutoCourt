import { fileURLToPath } from "node:url";

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
