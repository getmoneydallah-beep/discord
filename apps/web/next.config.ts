import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@majlis/shared", "@majlis/i18n", "@majlis/api-client"],
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // No framing (clickjacking), no MIME sniffing, no plugins, no <base> hijacking.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
  // Self-contained server bundle for Docker (Fly.io). Vercel ignores this.
  output: "standalone",
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), "../../"),
};

export default config;
