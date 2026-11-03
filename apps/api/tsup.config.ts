import { defineConfig } from "tsup";

// Bundle the API and all its dependencies into dist/ so the production image
// only needs Node + dist + migrations (no node_modules).
export default defineConfig({
  entry: ["src/index.ts", "src/migrate.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  clean: true,
  noExternal: [/.*/],
  external: ["bufferutil", "utf-8-validate"],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
