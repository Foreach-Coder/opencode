import { expect, test } from "bun:test"
import { WSL_EXECUTABLE_PROBE, wslInstallUnavailable } from "./policy"
import { Brand } from "@opencode-ai/brand"

test("probes only the product WSL executable", () => {
  expect(WSL_EXECUTABLE_PROBE).toContain(`$HOME/.${Brand.directory}/bin/${Brand.cli}`)
  expect(WSL_EXECUTABLE_PROBE).not.toContain(".opencode/bin/opencode")
})

test("does not invoke the upstream installer", () => {
  expect(wslInstallUnavailable()).toEqual({
    code: 1,
    signal: null,
    stdout: "",
    stderr: `${Brand.name} internal installer is not configured`,
  })
})
