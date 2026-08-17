import { expect, test } from "bun:test"
import { Product } from "../src"

test("product errors preserve code and safe message without swallowing cause", () => {
  const cause = new Error("disk failed")
  const error = new Product.ProductError("CONFIG_WRITE_DISABLED", "配置写入已由产品策略禁用", { cause })
  expect(error.code).toBe("CONFIG_WRITE_DISABLED")
  expect(error.message).toBe("配置写入已由产品策略禁用")
  expect(error.cause).toBe(cause)
})
