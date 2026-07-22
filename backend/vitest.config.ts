import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      // Test-only value, unrelated to any real deployment secret — just
      // needs to satisfy getJwtSecret()'s length check.
      JWT_SECRET: "test-only-secret-do-not-use-in-any-real-environment",
    },
  },
});
