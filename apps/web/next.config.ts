import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@majlis/shared", "@majlis/i18n", "@majlis/api-client"],
  reactStrictMode: true,
};

export default config;
