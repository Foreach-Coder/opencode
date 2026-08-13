import { describe, expect, test } from "bun:test"
import { Brand } from "../src"

describe("Brand", () => {
  test("defines the canonical product identity", () => {
    expect(Brand).toMatchObject({
      name: "ForeachCode",
      slug: "foreachcode",
      cli: "foreachcode",
      protocol: "foreachcode",
      directory: "foreachcode",
      database: "foreachcode.db",
      log: "foreachcode.log",
      desktopAppId: "ai.foreachcode.desktop",
    })
  })

  test("derives channel-specific desktop names and IDs", () => {
    expect(Brand.desktop).toEqual({
      dev: { name: "ForeachCode Dev", appId: "ai.foreachcode.desktop.dev" },
      beta: { name: "ForeachCode Beta", appId: "ai.foreachcode.desktop.beta" },
      prod: { name: "ForeachCode", appId: "ai.foreachcode.desktop" },
    })
  })

  test("cannot be mutated at runtime", () => {
    expect(Object.isFrozen(Brand)).toBe(true)
    expect(Object.isFrozen(Brand.desktop)).toBe(true)
    expect(Object.isFrozen(Brand.desktop.dev)).toBe(true)
    expect(() => Object.assign(Brand, { name: "Other" })).toThrow()
    expect(() => Object.assign(Brand.desktop.dev, { name: "Other Dev" })).toThrow()
  })
})
