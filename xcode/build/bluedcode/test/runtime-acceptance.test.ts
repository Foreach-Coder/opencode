import { afterAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createRuntimeAcceptanceEvidence, formatVisibleVersion, runPortableSmokeFixture } from "../common/runtime-acceptance"

const temporaryRoots: string[] = []

afterAll(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test("prod visible version uses full release identity", () => {
  expect(formatVisibleVersion({ opencodeVersion: "1.18.18", release: "260816-01", commit: "a39a781eb3" })).toBe(
    "1.18.18-260816-01-a39a781eb3",
  )
})

test("fresh profile startup has no main-process JavaScript error", async () => {
  const home = await fixtureHome("valid-admin-provider")
  const result = await runPortableSmokeFixture({ home })

  expect(result.mainProcessError).toBeUndefined()
  expect(result.loadedModel).toBe("openai-proxy/gpt-4.1")
  expect(result.defaultSessionCore).toBe("v1")
  expect(result.sessionCoreSwitchesTo).toBe("v2")
  expect(result.disabledEntrypoints).toEqual(["auth", "connect-provider", "share", "update"])
  expect(result.publicNetworkCalls).toEqual([])
  expect(result.deepLinkRefresh).toEqual({ moved: true, refreshed: true })
})

test("fixture reads the actual .config/bluedcode/opencode.json path and fails closed when it is absent", async () => {
  const home = await fixtureHome("missing-admin-provider", false)
  const result = await runPortableSmokeFixture({ home })

  expect(result.mainProcessError).toContain("opencode.json")
  await expect(createRuntimeAcceptanceEvidence({ home, visibleVersion: "1.18.18-dev-0123456789" })).rejects.toThrow(
    /主进程|opencode.json/i,
  )
})

test("admin model must resolve through the configured Provider whitelist", async () => {
  const home = await fixtureHome("unknown-admin-model", {
    model: "openai-proxy/not-allowed",
    provider: { "openai-proxy": { models: { "gpt-4.1": { name: "GPT 4.1" } } } },
  })
  const result = await runPortableSmokeFixture({ home })

  expect(result.mainProcessError).toContain("白名单")
})

test("runtime evidence retains stale-session recovery separately from fresh startup", async () => {
  const home = await fixtureHome("stale-session-evidence")
  const evidence = await createRuntimeAcceptanceEvidence({ home, visibleVersion: "1.18.18-dev-0123456789" })

  expect(evidence.smoke.recoveryError).toBeUndefined()
  expect(evidence.staleSession).toEqual({
    appShellLoaded: true,
    recoveryError: { code: "SESSION_NOT_FOUND", message: "Session not found: stale-session" },
  })
})

test("stale session not found is isolated to session recovery and does not crash the app shell", async () => {
  const home = await fixtureHome("stale-session")
  const result = await runPortableSmokeFixture({ home, sessionState: "stale" })

  expect(result.appShellLoaded).toBe(true)
  expect(result.recoveryError?.code).toBe("SESSION_NOT_FOUND")
  expect(result.recoveryError?.message).toBe("Session not found: stale-session")
})

async function fixtureHome(
  name: string,
  config: unknown = {
    model: "openai-proxy/gpt-4.1",
    provider: { "openai-proxy": { models: { "gpt-4.1": { name: "GPT 4.1" } } } },
  },
) {
  const root = await mkdtemp(path.join(os.tmpdir(), `bluedcode-runtime-${name}-`))
  temporaryRoots.push(root)
  const directory = path.join(root, ".config", "bluedcode")
  await mkdir(directory, { recursive: true })
  if (config === false) return root
  await writeFile(
    path.join(directory, "opencode.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  )
  return root
}
