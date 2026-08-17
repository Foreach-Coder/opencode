import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { ProductTelemetry } from "./telemetry"

const appRoot = path.resolve(import.meta.dir, "..")

async function source(relative: string) {
  return readFile(path.join(appRoot, relative), "utf8")
}

describe("ProductTelemetry", () => {
  test("禁用遥测时入口和错误页不静态导入 Sentry SDK", async () => {
    const files = await Promise.all(["entry.tsx", "app.tsx", "pages/error.tsx"].map(source))
    for (const file of files) {
      expect(file).not.toContain("@sentry/solid")
      expect(file).not.toContain("Sentry.")
      expect(file).not.toContain("https://opencode.ai/favicon")
    }
  })

  test("BluedCode Profile 下遥测根为 no-op", () => {
    expect(ProductTelemetry.isEnabled()).toBe(false)
    expect(ProductTelemetry.init({ dsn: "https://example.invalid/1", environment: "test", release: "test" })).toBe(
      false,
    )
    expect(ProductTelemetry.captureException(new Error("boom"))).toBe(false)
  })
})
