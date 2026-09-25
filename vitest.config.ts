import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Next.js enforces "server-only" in its bundler; in tests it is a no-op.
      "server-only": path.resolve(__dirname, "tests/setup/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    globalSetup: ["tests/setup/postgres.ts"],
    env: {
      SESSION_SECRET: "test-secret-test-secret-test-secret-0000",
      APP_URL: "http://localhost:3999",
    },
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
