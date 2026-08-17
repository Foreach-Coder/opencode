import { expect, test } from "bun:test"
import { parseDeepLink } from "./deep-links"

test("BluedCode deep links reach the renderer parser", () => {
  expect(parseDeepLink("bluedcode://open-project?directory=C%3A%5Cwork")).toBe("C:\\work")
  expect(parseDeepLink("bluedcode-dev://open-project?directory=C%3A%5Cwork")).toBe("C:\\work")
})
