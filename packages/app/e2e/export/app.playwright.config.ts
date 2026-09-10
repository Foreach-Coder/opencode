import config from "../../playwright.config"
import { defineConfig } from "@playwright/test"

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4468)
process.env.PLAYWRIGHT_PORT = String(port)
process.env.PLAYWRIGHT_SERVER_PORT = String(port)

export default defineConfig({
  ...config,
  testDir: "../regression",
  testMatch: "session-html-export.spec.ts",
  outputDir: "../test-results/export-integration",
  workers: 1,
  reporter: [["line"]],
  webServer: {
    ...config.webServer,
    command: `bun run build && bun run serve -- --host 0.0.0.0 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
  use: { ...config.use, baseURL: `http://127.0.0.1:${port}` },
})
