import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Some health/planner tests run real shell commands and can take 3-5s each.
    // Raise the per-test timeout so they don't flake when run in a full suite.
    testTimeout: 15000,
    hookTimeout: 10000,
  },
});
