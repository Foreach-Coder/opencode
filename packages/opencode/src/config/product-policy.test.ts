import { expect, test } from "bun:test"
import { ProductConfigPolicy } from "./product-policy"

test("允许显式本地偏好写入", () => {
  expect(ProductConfigPolicy.classifyWrite({ theme: "dark" })).toEqual({ kind: "preference", allowed: true })
  expect(() => ProductConfigPolicy.requireWrite({ theme: "dark" })).not.toThrow()
})

test.each([
  ["provider", { provider: { openai: {} } }],
  ["mcp", { mcp: { local: {} } }],
  ["plugin", { plugin: ["./plugin.ts"] }],
  ["未知字段", { unknown_field: true }],
])("拒绝 %s 配置写入", (_name, payload) => {
  expect(() => ProductConfigPolicy.requireWrite(payload)).toThrow("CONFIG_WRITE_DISABLED")
})

test.each([
  ["空对象", {}],
  ["theme 对象", { theme: { mode: "dark" } }],
  ["language 对象", { language: { code: "zh-CN" } }],
  ["font 对象", { font: { family: "sans" } }],
  ["newLayoutDesigns 对象", { newLayoutDesigns: { enabled: true } }],
])("拒绝 %s 本地偏好写入", (_name, payload) => {
  expect(() => ProductConfigPolicy.requireWrite(payload)).toThrow("CONFIG_WRITE_DISABLED")
})
