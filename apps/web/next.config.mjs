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
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "@node-rs/argon2"],
  },
};

export default nextConfig;
