import { defineConfig } from "vitest/config";

// Test files share one database and reset its schema, so run them one at a time.
export default defineConfig({ test: { fileParallelism: false, testTimeout: 20_000 } });
