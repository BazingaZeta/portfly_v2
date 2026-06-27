import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module; keep it external from the server bundle
  // so Turbopack/webpack don't try to bundle the .node binary.
  serverExternalPackages: ["better-sqlite3", "yahoo-finance2"],
  // Produce a standalone Node.js server for Docker deployment.
  output: "standalone",
};

export default nextConfig;
