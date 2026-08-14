import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { resolveBrand } from "../src/config"

describe("resolveBrand", () => {
  test("rejects a missing explicit brand", () => {
    expect(() => resolveBrand()).toThrow("explicit product name")
  })

  test("derives a machine identity for an ASCII alphanumeric name", () => {
    expect(resolveBrand({ cli: { name: "ACMECODE", channel: "prod" } })).toMatchObject({
      name: "ACMECODE",
      slug: "acmecode",
      cli: "acmecode",
      desktopAppId: "ai.acmecode.desktop",
      channel: "prod",
    })
  })

  test("derives the complete identity only from the supplied definition", () => {
    expect(
      resolveBrand({
        cli: { name: "Command", slug: "command", channel: "prod", desktopAppId: "com.example.command" },
      }),
    ).toMatchObject({ name: "Command", slug: "command", desktopAppId: "com.example.command", channel: "prod" })
  })

  test("requires an explicit slug when the selected name cannot be losslessly derived", () => {
    expect(() => resolveBrand({ cli: { name: "企业代码", channel: "dev" } })).toThrow("slug")
    expect(resolveBrand({ cli: { name: "企业代码", slug: "enterprise-code", channel: "dev" } })).toMatchObject({
      name: "企业代码",
      slug: "enterprise-code",
    })
  })

  test("rejects markup delimiters in the product name", () => {
    for (const name of ["A<B", "A&B", 'A"B', "A'B", "A\\B"]) {
      expect(() => resolveBrand({ cli: { name, slug: "safe-name", channel: "dev" } })).toThrow("markup delimiters")
    }
  })

  test("rejects invalid slug, desktop app ID, and channel before deriving consumers", () => {
    expect(() => resolveBrand({ cli: { name: "Acme", slug: "Not_Valid", channel: "dev" } })).toThrow("slug")
    expect(() =>
      resolveBrand({ cli: { name: "Acme", slug: "acme", desktopAppId: "not-an-app-id", channel: "dev" } }),
    ).toThrow("desktop app ID")
    expect(() => resolveBrand({ cli: { name: "Acme", slug: "acme", channel: "nightly" } })).toThrow("channel")
  })

  test("derives every consumer and channel identity from one resolved machine identity", () => {
    expect(
      resolveBrand({ cli: { name: "Acme Code", slug: "acme-code", desktopAppId: "com.acme.code", channel: "dev" } }),
    ).toMatchObject({
      cli: "acme-code",
      protocol: "acme-code",
      directory: "acme-code",
      database: "acme-code.db",
      log: "acme-code.log",
      desktopAppId: "com.acme.code",
      desktop: {
        dev: { name: "Acme Code Dev", appId: "com.acme.code.dev" },
        beta: { name: "Acme Code Beta", appId: "com.acme.code.beta" },
        prod: { name: "Acme Code", appId: "com.acme.code" },
      },
    })
  })

  test("deep-freezes the resolved identity", () => {
    const brand = resolveBrand({ cli: { name: "ACMECODE", channel: "dev" } })

    expect(Object.isFrozen(brand)).toBe(true)
    expect(Object.isFrozen(brand.desktop)).toBe(true)
    expect(Object.isFrozen(brand.desktop.dev)).toBe(true)
    expect(() => Object.assign(brand, { name: "Other" })).toThrow()
    expect(() => Object.assign(brand.desktop.dev, { name: "Other Dev" })).toThrow()
  })

  test("supports one browser-safe compile-time JSON injection point", async () => {
    const result = await Bun.build({
      entrypoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
      target: "browser",
      define: {
        PRODUCT_BRAND_JSON: JSON.stringify(JSON.stringify(resolveBrand({ cli: { name: "ACMECODE", channel: "dev" } }))),
      },
    })
    const output = await result.outputs[0]!.text()

    expect(result.success).toBe(true)
    expect(output).toContain("ACMECODE")
    expect(output).not.toContain("typeof PRODUCT_BRAND_JSON")
    expect(output).not.toContain("process.env")
    expect(output).not.toContain("Bun.env")
  })
})
