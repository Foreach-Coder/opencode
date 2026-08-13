import { describe, expect, test } from "bun:test"
import { ConfigManaged } from "@/config/managed"
import { Brand } from "@opencode-ai/brand"

describe("managed configuration identity", () => {
  test("uses the product macOS directory", () => {
    expect(ConfigManaged.systemManagedConfigDir("darwin")).toBe(`/Library/Application Support/${Brand.directory}`)
  })

  test("uses the product Windows directory", () => {
    expect(ConfigManaged.systemManagedConfigDir("win32", "D:\\ProgramData")).toBe(`D:\\ProgramData\\${Brand.directory}`)
  })

  test("uses the product Linux directory", () => {
    expect(ConfigManaged.systemManagedConfigDir("linux")).toBe(`/etc/${Brand.directory}`)
  })

  test("uses the product managed preferences domain", () => {
    expect(ConfigManaged.MANAGED_PLIST_DOMAIN).toBe(`ai.${Brand.slug}.managed`)
  })

  test("preserves the OPENCODE_TEST_MANAGED_CONFIG_DIR override", () => {
    expect(ConfigManaged.managedConfigDir()).toBe(process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR!)
  })
})
