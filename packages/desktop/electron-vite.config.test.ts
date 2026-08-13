import { expect, test } from "bun:test"
import config from "./electron.vite.config"

test("bundles the TypeScript brand workspace package into the Electron main process", () => {
  expect(config).toHaveProperty("main.build.externalizeDeps.exclude", ["@opencode-ai/brand"])
})

test("uses one build channel for the Electron main and renderer processes", () => {
  expect(config.renderer?.define?.["import.meta.env.VITE_OPENCODE_CHANNEL"]).toBe(
    config.main?.define?.["import.meta.env.OPENCODE_CHANNEL"],
  )
})
