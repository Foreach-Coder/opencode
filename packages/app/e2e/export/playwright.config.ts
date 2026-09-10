import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "../test-results/export",
  workers: 1,
  timeout: 30_000,
  use: { browserName: "chromium" },
})
