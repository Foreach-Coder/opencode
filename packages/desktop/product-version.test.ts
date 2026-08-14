import { expect, test } from "bun:test"
import { requireProductVersion } from "./product-version"

test("accepts explicit and commit-based product versions", () => {
  expect(requireProductVersion("1.17.9-260814-02")).toBe("1.17.9-260814-02")
  expect(requireProductVersion("1.17.9-260814-4f9f129a61")).toBe("1.17.9-260814-4f9f129a61")
})

test("rejects product versions outside the shared contract", () => {
  expect(() => requireProductVersion("1.17.9")).toThrow("YYMMDD")
  expect(() => requireProductVersion("1.17.9-260814-invalid!")).toThrow("YYMMDD")
})
