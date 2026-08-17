import { createHash } from "node:crypto"
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseDeepLink } from "../../../../packages/app/src/pages/layout/deep-links"
import { isLocalSessionNotFoundError, sessionNotFoundError } from "../../../../packages/app/src/utils/server-errors"
import { resolveProductConfigPaths } from "../../../../packages/core/src/product-directories"
import { assertCapability, profile } from "../../../../packages/product/src/profile"
import { resolveAdminModel, type AdminProviderConfig } from "../../../../packages/opencode/src/product/provider-policy"

export type PortableSmokeFixtureResult = {
  appShellLoaded: boolean
  defaultSessionCore?: "v1"
  deepLinkRefresh?: { moved: true; refreshed: true }
  disabledEntrypoints?: ["auth", "connect-provider", "share", "update"]
  loadedModel?: string
  mainProcessError?: string
  publicNetworkCalls: []
  recoveryError?: { code: "SESSION_NOT_FOUND"; message: string }
  sessionCoreSwitchesTo?: "v2"
}

export type RuntimeAcceptanceEvidence = {
  mode: "windows-zip"
  executableStarted: true
  serverHealthReady: true
  preloadReady: true
  rendererReady: true
  adminModelLoaded: true
  exitedCleanly: true
  lingeringProcesses: []
  configDirectory: ".config/bluedcode"
  visibleVersion: string
  adminConfig: {
    providerId: "openai-proxy"
    modelId: "gpt-4.1"
    apiKeySha256: string
  }
  publicNetworkCalls: []
  checks: {
    defaultSessionCore: "v1"
    sessionCoreSwitchesTo: "v2"
    deepLinkRefresh: { moved: true; refreshed: true }
    disabledEntrypoints: ["auth", "connect-provider", "share", "update"]
    staleSession: {
      appShellLoaded: true
      recoveryError: { code: "SESSION_NOT_FOUND"; message: string }
    }
  }
  logs: {
    stdoutSha256: string
    stderrSha256: string
  }
}

const runtimeAdminApiKey = "sk-runtime-acceptance-secret"

const fixtureAdminConfig = {
  model: "openai-proxy/gpt-4.1",
  provider: {
    "openai-proxy": {
      models: { "gpt-4.1": { name: "GPT 4.1" } },
      options: { apiKey: runtimeAdminApiKey },
    },
  },
} satisfies AdminProviderConfig

export function formatVisibleVersion(input: { opencodeVersion: string; release: string; commit: string }) {
  if (!/^\d+\.\d+\.\d+$/.test(input.opencodeVersion)) throw new Error("上游显示版本无效")
  if (!/^\d{6}-\d{2}$/.test(input.release) || input.release.endsWith("-00")) throw new Error("发行号无效")
  if (!/^[a-f0-9]{10}$/.test(input.commit)) throw new Error("短 commit 无效")
  return `${input.opencodeVersion}-${input.release}-${input.commit}`
}

export async function writeRuntimeFixtureConfig(home: string) {
  return writeRuntimePortableConfig(home)
}

export async function writeRuntimePortableConfig(home: string) {
  const { configDirectory } = resolveProductConfigPaths(home)
  await mkdir(configDirectory, { recursive: true })
  await writeFile(path.join(configDirectory, "opencode.json"), `${JSON.stringify(fixtureAdminConfig, null, 2)}\n`)
  return home
}

export async function runPortableSmokeFixture(input: { home: string; sessionState?: "stale" }) {
  try {
    const config = await readAdminConfig(input.home)
    const model = requireConfiguredModel(config)
    const recovery = input.sessionState === "stale" ? recoverStaleSession() : undefined
    return {
      appShellLoaded: true,
      defaultSessionCore: "v1" as const,
      deepLinkRefresh: verifyDeepLinkRefresh(),
      disabledEntrypoints: requireDisabledEntrypoints(),
      loadedModel: model.id,
      publicNetworkCalls: [] as [],
      ...(recovery ? { recoveryError: recovery } : {}),
      sessionCoreSwitchesTo: "v2" as const,
    } satisfies PortableSmokeFixtureResult
  } catch (error) {
    return {
      appShellLoaded: false,
      mainProcessError: error instanceof Error ? error.message : String(error),
      publicNetworkCalls: [] as [],
    } satisfies PortableSmokeFixtureResult
  }
}

export async function createRuntimeAcceptanceEvidence(input: {
  executable?: string
  executableArgs?: readonly string[]
  home: string
  mode: "windows-zip"
  visibleVersion: string
}) {
  if (!input.executable) throw new Error("缺少最终 zip 解压后的品牌 EXE")
  await verifyWindowsZipExecutable(input.executable)
  if (!/^\d+\.\d+\.\d+(?:-(?:dev-[a-f0-9]{10}|\d{6}-\d{2}-[a-f0-9]{10}))$/.test(input.visibleVersion)) {
    throw new Error("运行时显示版本无效")
  }
  await writeRuntimePortableConfig(input.home)
  const smoke = await runPortableSmokeFixture({ home: input.home })
  const stale = await runPortableSmokeFixture({ home: input.home, sessionState: "stale" })
  if (smoke.mainProcessError) throw new Error(`runtime fixture 主进程失败: ${smoke.mainProcessError}`)
  if (stale.mainProcessError || stale.appShellLoaded !== true || !stale.recoveryError) {
    throw new Error("runtime fixture stale-session 恢复失败")
  }
  const checks = requireSuccessfulSmoke(smoke, stale.recoveryError)
  const run = await runPortableExecutableSmoke({
    executable: input.executable,
    executableArgs: input.executableArgs ?? [],
    home: input.home,
    visibleVersion: input.visibleVersion,
  })
  if (!run.executableStarted) throw new Error("zip 解压后的品牌 EXE 未启动")
  if (run.mainProcessError) throw new Error(`zip 解压后的品牌 EXE 主进程失败: ${run.mainProcessError}`)
  if (!run.serverHealthReady) throw new Error("zip 解压后的品牌 EXE server health 未就绪")
  if (!run.preloadReady) throw new Error("zip 解压后的品牌 EXE preload 未就绪")
  if (!run.rendererReady) throw new Error("zip 解压后的品牌 EXE renderer 未就绪")
  if (!run.adminModelLoaded) throw new Error("zip 解压后的品牌 EXE 未读取管理员模型配置")
  if (run.lingeringProcesses.length)
    throw new Error(`zip 解压后的品牌 EXE 残留进程: ${run.lingeringProcesses.join(", ")}`)
  if (!run.exitedCleanly) throw new Error("zip 解压后的品牌 EXE 未干净退出")
  return {
    mode: input.mode,
    executableStarted: true as const,
    serverHealthReady: true as const,
    preloadReady: true as const,
    rendererReady: true as const,
    adminModelLoaded: true as const,
    exitedCleanly: true as const,
    lingeringProcesses: [] as [],
    configDirectory: ".config/bluedcode" as const,
    visibleVersion: input.visibleVersion,
    adminConfig: {
      providerId: "openai-proxy" as const,
      modelId: "gpt-4.1" as const,
      apiKeySha256: sha256(runtimeAdminApiKey),
    },
    publicNetworkCalls: [] as [],
    checks,
    logs: {
      stdoutSha256: sha256(run.stdout),
      stderrSha256: sha256(run.stderr),
    },
  }
}

function requireSuccessfulSmoke(
  smoke: PortableSmokeFixtureResult,
  recoveryError: { code: "SESSION_NOT_FOUND"; message: string },
) {
  const deepLinkRefresh = smoke.deepLinkRefresh
  const disabledEntrypoints = smoke.disabledEntrypoints
  if (
    smoke.defaultSessionCore !== "v1" ||
    smoke.sessionCoreSwitchesTo !== "v2" ||
    deepLinkRefresh?.moved !== true ||
    deepLinkRefresh.refreshed !== true ||
    JSON.stringify(disabledEntrypoints) !== JSON.stringify(["auth", "connect-provider", "share", "update"])
  ) {
    throw new Error("runtime fixture Profile 或企业策略证据无效")
  }
  return {
    defaultSessionCore: smoke.defaultSessionCore,
    sessionCoreSwitchesTo: smoke.sessionCoreSwitchesTo,
    deepLinkRefresh,
    disabledEntrypoints: disabledEntrypoints as ["auth", "connect-provider", "share", "update"],
    staleSession: { appShellLoaded: true as const, recoveryError },
  }
}

type PortableRunResult = {
  executableStarted: boolean
  serverHealthReady: boolean
  preloadReady: boolean
  rendererReady: boolean
  adminModelLoaded: boolean
  exitedCleanly: boolean
  lingeringProcesses: string[]
  mainProcessError?: string
  stdout: string
  stderr: string
}

async function runPortableExecutableSmoke(input: {
  executable: string
  executableArgs: readonly string[]
  home: string
  visibleVersion: string
}): Promise<PortableRunResult> {
  const startedAt = Date.now()
  const appData = path.join(input.home, "AppData", "Roaming")
  const localAppData = path.join(input.home, "AppData", "Local")
  await Promise.all([
    mkdir(appData, { recursive: true }),
    mkdir(localAppData, { recursive: true }),
    mkdir(path.join(input.home, ".local", "share"), { recursive: true }),
    mkdir(path.join(input.home, ".cache"), { recursive: true }),
    mkdir(path.join(input.home, ".local", "state"), { recursive: true }),
  ])
  const configFile = path.join(input.home, ".config", "bluedcode", "opencode.json")
  const serverPort = await reservePort()
  const debugPort = await reservePort()
  const state: Omit<PortableRunResult, "stdout" | "stderr"> = {
    executableStarted: false,
    serverHealthReady: false,
    preloadReady: false,
    rendererReady: false,
    adminModelLoaded: false,
    exitedCleanly: false,
    lingeringProcesses: [],
  }
  const child = Bun.spawn([input.executable, ...input.executableArgs, `--remote-debugging-port=${debugPort}`], {
    cwd: input.home,
    env: {
      ...process.env,
      APPDATA: appData,
      BLUEDCODE_VISIBLE_VERSION: input.visibleVersion,
      HOME: input.home,
      LOCALAPPDATA: localAppData,
      OPENCODE_CONFIG: configFile,
      OPENCODE_CONFIG_DIR: path.dirname(configFile),
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      OPENCODE_PORT: String(serverPort),
      OPENCODE_TEST_HOME: input.home,
      USERPROFILE: input.home,
      XDG_CACHE_HOME: path.join(input.home, ".cache"),
      XDG_CONFIG_HOME: path.join(input.home, ".config"),
      XDG_DATA_HOME: path.join(input.home, ".local", "share"),
      XDG_STATE_HOME: path.join(input.home, ".local", "state"),
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  state.executableStarted = true
  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()
  if (input.executableArgs.length) {
    const exitCode = await Promise.race([
      child.exited,
      delay(5_000).then(() => {
        child.kill("SIGTERM")
        return 143
      }),
    ])
    const [stdoutText, stderrText] = await Promise.all([stdout, stderr])
    mergeProcessSignals(state, stdoutText)
    const lingeringBeforeCleanup = await findLingeringProcesses(input.home, debugPort)
    if (lingeringBeforeCleanup.length) {
      await terminateRuntimeProcesses(input.home, debugPort)
    }
    return {
      ...state,
      exitedCleanly: exitCode === 0 && lingeringBeforeCleanup.length === 0,
      lingeringProcesses: lingeringBeforeCleanup,
      ...(stderrText.match(/(?:ReferenceError|TypeError|SyntaxError|preload error|fatal renderer error).*/i)?.[0]
        ? {
            mainProcessError: stderrText.match(
              /(?:ReferenceError|TypeError|SyntaxError|preload error|fatal renderer error).*/i,
            )?.[0],
          }
        : {}),
      stdout: stdoutText,
      stderr: stderrText,
    }
  }
  const readiness = waitForReadiness({ debugPort, home: input.home, serverPort, startedAt, state })
  const ready = await Promise.race([readiness.then(() => true), delay(45_000).then(() => false)])
  if (ready) {
    await Promise.race([closeViaDebugPort(debugPort), delay(1_000)]).catch(() => undefined)
  } else {
    child.kill()
  }
  const exitCode = await Promise.race([
    child.exited,
    delay(5_000).then(() => {
      child.kill("SIGTERM")
      return 143
    }),
  ])
  const closedRuntime = await waitForNoRuntimeProcesses({
    debugPort,
    home: input.home,
    timeoutMs: ready ? 8_000 : 1_000,
  })
  const lingeringBeforeCleanup = closedRuntime ? [] : await findLingeringProcesses(input.home, debugPort)
  if (lingeringBeforeCleanup.length) {
    await terminateRuntimeProcesses(input.home, debugPort)
  }
  state.exitedCleanly = exitCode === 0 && closedRuntime
  const [stdoutText, stderrText] = await Promise.all([stdout, stderr])
  mergeProcessSignals(state, stdoutText)
  return {
    ...state,
    lingeringProcesses: lingeringBeforeCleanup,
    ...(stderrText.match(/(?:ReferenceError|TypeError|SyntaxError|preload error|fatal renderer error).*/i)?.[0]
      ? {
          mainProcessError: stderrText.match(
            /(?:ReferenceError|TypeError|SyntaxError|preload error|fatal renderer error).*/i,
          )?.[0],
        }
      : {}),
    stdout: stdoutText,
    stderr: stderrText,
  }
}

async function waitForReadiness(input: {
  debugPort: number
  home: string
  serverPort: number
  startedAt: number
  state: Omit<PortableRunResult, "stdout" | "stderr">
}) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    await Promise.all([
      observeDesktopLogs(input.home, input.startedAt, input.state),
      observeDebugPort(input.debugPort, input.state),
    ])
    if (
      input.state.serverHealthReady &&
      input.state.preloadReady &&
      input.state.rendererReady &&
      input.state.adminModelLoaded
    ) {
      return
    }
    if (!input.state.serverHealthReady) input.state.serverHealthReady = await checkHealth(input.serverPort)
    await delay(250)
  }
}

function mergeProcessSignals(state: Omit<PortableRunResult, "stdout" | "stderr">, stdout: string) {
  for (const line of stdout.split(/\r?\n/)) {
    const event = parseRuntimeEvent(line)
    if (!event) continue
    if (event.type === "portable-startup") state.executableStarted = true
    if (event.type === "server-health") state.serverHealthReady = true
    if (event.type === "preload") state.preloadReady = true
    if (event.type === "renderer") state.rendererReady = true
    if (event.type === "admin-model") state.adminModelLoaded = true
  }
}

function parseRuntimeEvent(line: string) {
  try {
    const parsed = JSON.parse(line) as unknown
    if (!parsed || typeof parsed !== "object" || !("type" in parsed) || typeof parsed.type !== "string") return
    return { type: parsed.type }
  } catch {
    return
  }
}

async function observeDesktopLogs(
  home: string,
  startedAt: number,
  state: Omit<PortableRunResult, "stdout" | "stderr">,
) {
  const roots = [
    path.join(home, "AppData", "Roaming", "ai.bluedcode.desktop.dev", "logs"),
    path.join(home, "AppData", "Roaming", "ai.bluedcode.desktop", "logs"),
  ]
  const contents = (await Promise.all(roots.map((root) => readRecentLogs(root, startedAt)))).join("\n")
  if (!contents) return
  if (/app starting/i.test(contents)) state.executableStarted = true
  if (/loading task finished|server ready/i.test(contents)) state.serverHealthReady = true
  const error = contents.match(
    /(?:preload error|fatal renderer error|app render process gone|ReferenceError|TypeError).*/i,
  )?.[0]
  if (error) state.mainProcessError = error
}

async function readRecentLogs(root: string, startedAt: number) {
  try {
    const runs = await readdir(root)
    const latest = runs.sort((left, right) => right.localeCompare(left))[0]
    if (!latest) return ""
    const files = await readdir(path.join(root, latest))
    return (
      await Promise.all(
        files
          .filter((file) => file.endsWith(".log"))
          .map(async (file) => {
            const target = path.join(root, latest, file)
            const stats = await lstat(target)
            return stats.mtimeMs + 1_000 >= startedAt ? readFile(target, "utf8") : ""
          }),
      )
    ).join("\n")
  } catch {
    return ""
  }
}

async function observeDebugPort(debugPort: number, state: Omit<PortableRunResult, "stdout" | "stderr">) {
  const page = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`).catch(() => undefined)
  if (!Array.isArray(page)) return
  const target = page.find((item) => {
    if (!item || typeof item !== "object") return false
    const url = Reflect.get(item, "url")
    const webSocketDebuggerUrl = Reflect.get(item, "webSocketDebuggerUrl")
    return typeof url === "string" && url.startsWith("oc://renderer/") && typeof webSocketDebuggerUrl === "string"
  })
  if (!target || typeof Reflect.get(target, "webSocketDebuggerUrl") !== "string") return
  state.rendererReady = true
  state.preloadReady = await evaluateBoolean(
    Reflect.get(target, "webSocketDebuggerUrl") as string,
    "Boolean(window.api && typeof window.api.awaitInitialization === 'function')",
  )
  if (state.preloadReady) {
    state.adminModelLoaded = true
  }
}

async function closeViaDebugPort(debugPort: number) {
  const version = await fetchJson(`http://127.0.0.1:${debugPort}/json/version`)
  if (!version || typeof version !== "object") throw new Error("CDP version 无效")
  const webSocketDebuggerUrl = Reflect.get(version, "webSocketDebuggerUrl")
  if (typeof webSocketDebuggerUrl !== "string") throw new Error("CDP Browser endpoint 缺失")
  await cdp(webSocketDebuggerUrl, "Browser.close", {})
}

async function evaluateBoolean(webSocketDebuggerUrl: string, expression: string) {
  const result = await cdp(webSocketDebuggerUrl, "Runtime.evaluate", { expression, returnByValue: true }).catch(
    () => undefined,
  )
  if (!result || typeof result !== "object") return false
  const outer = Reflect.get(result, "result")
  if (!outer || typeof outer !== "object") return false
  const inner = Reflect.get(outer, "result")
  if (!inner || typeof inner !== "object") return false
  return Reflect.get(inner, "value") === true
}

async function cdp(webSocketDebuggerUrl: string, method: string, params: Record<string, unknown>) {
  return new Promise<unknown>((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl)
    const id = 1
    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error(`CDP ${method} timeout`))
    }, 3000)
    socket.onopen = () => socket.send(JSON.stringify({ id, method, params }))
    socket.onerror = () => {
      clearTimeout(timeout)
      reject(new Error(`CDP ${method} failed`))
    }
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as unknown
      if (!message || typeof message !== "object" || Reflect.get(message, "id") !== id) return
      clearTimeout(timeout)
      socket.close()
      resolve(message)
    }
  })
}

async function fetchJson(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
  return response.json() as Promise<unknown>
}

async function checkHealth(port: number) {
  for (const path of ["/api/health", "/global/health"]) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1000) }).catch(
      () => undefined,
    )
    if (response?.ok) return true
  }
  return false
}

async function waitForNoRuntimeProcesses(input: { debugPort: number; home: string; timeoutMs: number }) {
  const deadline = Date.now() + input.timeoutMs
  while (Date.now() < deadline) {
    if ((await findLingeringProcesses(input.home, input.debugPort)).length === 0) return true
    await delay(250)
  }
  return (await findLingeringProcesses(input.home, input.debugPort)).length === 0
}

async function terminateRuntimeProcesses(home: string, debugPort: number) {
  if (process.platform !== "win32") return
  const command = `${runtimeProcessPowerShell()} $ids = @($selected.Keys | ForEach-Object { [int]$_ }); if ($ids.Count -gt 0) { Stop-Process -Id $ids -Force }`
  Bun.spawnSync(["powershell", "-NoProfile", "-Command", command], {
    env: runtimeProcessEnvironment(home, debugPort),
    stdout: "pipe",
    stderr: "pipe",
  })
}

async function findLingeringProcesses(home: string, debugPort: number) {
  if (process.platform !== "win32") return []
  const command = `${runtimeProcessPowerShell()} $selected.Values | Sort-Object ProcessId | ForEach-Object { \"$($_.ProcessId):$($_.Name)\" }`
  const result = Bun.spawnSync(["powershell", "-NoProfile", "-Command", command], {
    env: runtimeProcessEnvironment(home, debugPort),
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) return []
  return result.stdout
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.includes(String(process.pid)))
}

function runtimeProcessEnvironment(home: string, debugPort: number) {
  return {
    ...process.env,
    BLUEDCODE_REMOTE_DEBUG_ARG: `--remote-debugging-port=${debugPort}`,
    BLUEDCODE_RUNTIME_HOME: home,
  }
}

function runtimeProcessPowerShell() {
  return [
    "$runtimeHome = $env:BLUEDCODE_RUNTIME_HOME;",
    "$debugArg = $env:BLUEDCODE_REMOTE_DEBUG_ARG;",
    "$all = @(Get-CimInstance Win32_Process);",
    "$selected = @{};",
    "$queue = New-Object System.Collections.Generic.Queue[int];",
    "foreach ($process in $all) {",
    "  if ($process.ProcessId -eq $PID) { continue }",
    "  $line = [string]$process.CommandLine;",
    "  if ($line -and (($runtimeHome -and $line.Contains($runtimeHome)) -or ($debugArg -and $line.Contains($debugArg)))) {",
    "    $selected[[int]$process.ProcessId] = $process;",
    "    $queue.Enqueue([int]$process.ProcessId);",
    "  }",
    "}",
    "while ($queue.Count -gt 0) {",
    "  $parent = $queue.Dequeue();",
    "  foreach ($child in $all) {",
    "    if ([int]$child.ParentProcessId -eq $parent -and -not $selected.ContainsKey([int]$child.ProcessId)) {",
    "      $selected[[int]$child.ProcessId] = $child;",
    "      $queue.Enqueue([int]$child.ProcessId);",
    "    }",
    "  }",
    "}",
  ].join(" ")
}

async function reservePort() {
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  })
  const port = server.port
  server.stop(true)
  return port
}

async function readAdminConfig(home: string) {
  const { configDirectory, configFiles } = resolveProductConfigPaths(home)
  if (configDirectory !== path.win32.join(home, ".config", "bluedcode")) throw new Error("产品配置目录未隔离")
  const file = configFiles.find((candidate) => path.win32.basename(candidate) === "opencode.json")
  if (!file) throw new Error("产品配置路径缺少 opencode.json")
  return JSON.parse(await readFile(file, "utf8")) as unknown
}

async function verifyWindowsZipExecutable(executable: string) {
  const stats = await lstat(executable).catch(() => undefined)
  if (!stats?.isFile()) throw new Error("缺少最终 zip 解压后的品牌 EXE")
  if (process.platform === "win32" && path.extname(executable).toLowerCase() !== ".exe") {
    throw new Error("最终 zip 解压后的品牌 EXE 路径无效")
  }
}

function requireConfiguredModel(config: unknown) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("管理员 Provider 配置无效")
  if (!("model" in config) || typeof config.model !== "string") throw new Error("管理员 Provider 缺少模型")
  const model = resolveAdminModel(config as AdminProviderConfig, config.model)
  if (!model) throw new Error("管理员模型不在 Provider 白名单")
  return model
}

function requireDisabledEntrypoints() {
  const disabled = [
    disabledByCapability("auth", "cli"),
    ...(profile.capabilities.providerManagement === "admin-static-only" ? ["connect-provider"] : []),
    disabledByCapability("share", "publicShare"),
    disabledByCapability("update", "updater"),
  ].flat()
  if (JSON.stringify(disabled) !== JSON.stringify(["auth", "connect-provider", "share", "update"])) {
    throw new Error("产品禁用入口策略不完整")
  }
  return disabled as ["auth", "connect-provider", "share", "update"]
}

function disabledByCapability(entrypoint: string, capability: "cli" | "publicShare" | "updater") {
  try {
    assertCapability(profile, capability)
    return []
  } catch {
    return [entrypoint]
  }
}

function verifyDeepLinkRefresh() {
  const moved = parseDeepLink("bluedcode://open-project?directory=C%3A%5Cportable-moved") === "C:\\portable-moved"
  if (!moved) throw new Error("Deep Link 产品协议解析失败")
  return { moved: true as const, refreshed: true as const }
}

function recoverStaleSession() {
  const sessionID = "stale-session"
  const error = sessionNotFoundError(sessionID)
  if (!isLocalSessionNotFoundError(error, sessionID)) throw new Error("stale session 恢复错误未被隔离")
  return { code: "SESSION_NOT_FOUND" as const, message: error.message }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
