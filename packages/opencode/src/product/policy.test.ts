import { expect, test } from "bun:test"
import { ProductPolicy } from "./policy"

test("产品 HTTP 配置策略拒绝集成配置", () => {
  expect(() => ProductPolicy.rejectConfigWrite({ provider: { openai: {} } })).toThrow("CONFIG_WRITE_DISABLED")
})
