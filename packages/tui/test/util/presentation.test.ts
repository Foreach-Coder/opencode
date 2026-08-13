import { expect, test } from "bun:test"
import { Brand } from "@opencode-ai/brand"
import { sessionEpilogue } from "../../src/util/presentation"

test("formats session continuation summary", () => {
  const epilogue = sessionEpilogue({ title: "A session", sessionID: "ses_123" })
  expect(epilogue).toContain("A session")
  expect(epilogue).toContain(`${Brand.cli} -s ses_123`)
})
