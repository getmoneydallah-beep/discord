import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@majlis/shared", "@majlis/i18n", "@majlis/api-client"],
  reactStrictMode: true,
  // Self-contained server bundle for Docker (Fly.io). Vercel ignores this.
  output: "standalone",
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), "../../"),
};

export default config;
