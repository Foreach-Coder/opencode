import { afterAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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

test("runtime acceptance requires the final Portable executable instead of source fixture evidence", async () => {
  const home = await fixtureHome("missing-portable-exe")

  await expect(createRuntimeAcceptanceEvidence({ home, visibleVersion: "1.18.18-dev-0123456789" })).rejects.toThrow(
    /缺少最终 Portable EXE/i,
  )
})

test("portable smoke evidence records executable readiness, isolated admin model and clean shutdown without secrets", async () => {
  const home = await fixtureHome("portable-smoke", false)
  const executable = await fakePortableExecutable("portable-smoke")
  const evidence = await createRuntimeAcceptanceEvidence({
    executable: process.execPath,
    executableArgs: [executable],
    home,
    visibleVersion: "1.18.18-dev-0123456789",
  })

  expect(evidence).toMatchObject({
    mode: "portable",
    executableStarted: true,
    serverHealthReady: true,
    preloadReady: true,
    rendererReady: true,
    adminModelLoaded: true,
    exitedCleanly: true,
    lingeringProcesses: [],
    configDirectory: ".config/bluedcode",
    visibleVersion: "1.18.18-dev-0123456789",
  })
  expect(evidence.checks).toMatchObject({
    defaultSessionCore: "v1",
    sessionCoreSwitchesTo: "v2",
    deepLinkRefresh: { moved: true, refreshed: true },
    disabledEntrypoints: ["auth", "connect-provider", "share", "update"],
    staleSession: {
      appShellLoaded: true,
      recoveryError: { code: "SESSION_NOT_FOUND", message: "Session not found: stale-session" },
    },
  })
  expect(evidence.adminConfig).toEqual({
    apiKeySha256: "be1a186ad5399278bd0942db2185028509cd423bf6635b3ac76667935504b1ba",
    modelId: "gpt-4.1",
    providerId: "openai-proxy",
  })
  expect(JSON.stringify(evidence)).not.toContain("sk-runtime-acceptance-secret")
}, 15_000)

test("portable smoke fails closed and cleans up when the extracted app leaves runtime processes", async () => {
  const home = await fixtureHome("portable-lingering", false)
  const executable = await fakePortableExecutable("portable-lingering", { lingering: true })

  await expect(
    createRuntimeAcceptanceEvidence({
      executable: process.execPath,
      executableArgs: [executable],
      home,
      visibleVersion: "1.18.18-dev-0123456789",
    }),
  ).rejects.toThrow("残留进程")

  if (process.platform === "win32") {
    const check = Bun.spawnSync(
      [
        "powershell",
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:BLUEDCODE_RUNTIME_HOME) } | Measure-Object | Select-Object -ExpandProperty Count",
      ],
      { env: { ...process.env, BLUEDCODE_RUNTIME_HOME: home }, stdout: "pipe" },
    )
    expect(check.stdout.toString("utf8").trim()).toBe("0")
  }
}, 15_000)

test("真实 Portable readiness 不能由旧日志直接置为成功", async () => {
  const source = await readFile(path.resolve(import.meta.dir, "../common/runtime-acceptance.ts"), "utf8")
  const logsObserver = source.match(/async function observeDesktopLogs[\s\S]*?\n}\n\nasync function readRecentLogs/)?.[0] ?? ""

  expect(logsObserver).not.toContain("state.preloadReady = true")
  expect(logsObserver).not.toContain("state.rendererReady = true")
  expect(logsObserver).not.toContain("state.adminModelLoaded = true")
  expect(logsObserver).toContain("startedAt")
  expect(source).toContain("stats.mtimeMs")
  expect(source).toContain("checkHealth(input.serverPort)")
  expect(source).toContain("observeDebugPort(input.debugPort")
})

test("fixture reads the actual .config/bluedcode/opencode.json path and fails closed when it is absent", async () => {
  const home = await fixtureHome("missing-admin-provider", false)
  const result = await runPortableSmokeFixture({ home })

  expect(result.mainProcessError).toContain("opencode.json")
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
  const executable = await fakePortableExecutable("stale-session-evidence")
  const evidence = await createRuntimeAcceptanceEvidence({
    executable: process.execPath,
    executableArgs: [executable],
    home,
    visibleVersion: "1.18.18-dev-0123456789",
  })

  expect(evidence.checks.staleSession).toEqual({
    appShellLoaded: true,
    recoveryError: { code: "SESSION_NOT_FOUND", message: "Session not found: stale-session" },
  })
}, 15_000)

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

async function fakePortableExecutable(name: string, options: { lingering?: boolean } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), `bluedcode-runtime-${name}-script-`))
  temporaryRoots.push(root)
  const script = path.join(root, "fake-portable-smoke.js")
  await writeFile(
    script,
    [
      "const fs = await import('node:fs/promises')",
      "const config = JSON.parse(await fs.readFile(process.env.OPENCODE_CONFIG, 'utf8'))",
      "if (config.provider['openai-proxy'].options.apiKey !== 'sk-runtime-acceptance-secret') process.exit(3)",
      "for (const type of ['portable-startup', 'server-health', 'preload', 'renderer', 'admin-model']) {",
      "  console.log(JSON.stringify({ type, visibleVersion: process.env.BLUEDCODE_VISIBLE_VERSION }))",
      "}",
      ...(options.lingering
        ? [
            "const childProcess = await import('node:child_process')",
            "const child = childProcess.spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', process.env.OPENCODE_TEST_HOME], { detached: true, stdio: 'ignore' })",
            "child.unref()",
          ]
        : []),
    ].join("\n"),
  )
  return script
}
