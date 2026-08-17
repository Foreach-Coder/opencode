import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { Git } from "../common/git"
import {
  createReleaseManifest,
  publishRelease,
  serializeReleaseManifest,
  type ReleaseManifestInput,
} from "../common/manifest"
import type { BuildIdentity } from "../common/types"
import { createBuildPaths } from "../common/paths"
import { createBuilderConfig, nativeRuntimeFiles, resourceEditorLock } from "../version/1.18.18/electron-builder"
import { adapter11818 } from "../version/1.18.18"
import {
  auditAsarContents,
  auditElectronOutput,
  createAsarPackageJson,
  findPortableArtifact,
  forceElectronBuilderDebugOff,
  isElectronBuilderModule,
  packagePortable,
  type NativeRuntimeManifest,
  preflightBuild,
  preparePackagingInput,
  readPeMetadata,
  validatePortablePe,
  validateWinUnpackedExecutables,
  verifyElectronViteEvidence,
} from "../build"

const temporaryRoots: string[] = []

afterAll(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("preflightBuild", () => {
  test("prod 在快照检查前刷新远端 tag、验证全局序号并拒绝 dirty", async () => {
    const events: string[] = []
    const git = gitFixture(events, {
      dirty: " M tracked.ts\n",
      tags: "bluedcode-v1.18.17-260815-01\n",
    })

    await expectFailure(
      preflightBuild(["--channel", "prod", "--release", "260815-02"], {
        git,
        repositoryRoot: "D:/fixture/repository",
        verifySnapshot: async () => {
          events.push("snapshot")
          return { frameworkVersion: 1, files: {} }
        },
      }),
      /不干净/,
    )
    expect(events.slice(0, 2)).toEqual(["git:fetch --tags", "git:tag --list bluedcode-v*"])
    expect(events).not.toContain("snapshot")
  })

  test("dev 不 fetch、不消费发行序号并完成真实 Git/快照预检", async () => {
    const events: string[] = []
    const result = await preflightBuild(["--channel", "dev"], {
      git: gitFixture(events, { dirty: "", commit: adapter11818.commit }),
      repositoryRoot: "D:/fixture/repository",
      verifySnapshot: async () => {
        events.push("snapshot")
        return { frameworkVersion: 1, files: { "brand.json": "a".repeat(64) } }
      },
    })

    expect(result.identity).toMatchObject({
      channel: "dev",
      commit: adapter11818.commit,
      version: `1.18.18-dev-${adapter11818.commit.slice(0, 10)}`,
    })
    expect(result.releaseTags).toEqual([])
    expect(events.some((event) => event.includes("fetch"))).toBe(false)
    expect(events.at(-1)).toBe("snapshot")
  })

  test("dev HEAD 无 baseline exact tag 时仍按受信 baseline 选择适配器", async () => {
    const events: string[] = []
    const headCommit = "abcdefabcdefabcdefabcdefabcdefabcdefabcd"
    const result = await preflightBuild(["--channel", "dev"], {
      git: gitFixture(events, { dirty: "", commit: headCommit, exactTag: null }),
      repositoryRoot: "D:/fixture/repository",
      verifySnapshot: async () => {
        events.push("snapshot")
        return { frameworkVersion: 1, files: { "brand.json": "a".repeat(64) } }
      },
    })

    expect(result.identity.commit).toBe(headCommit)
    expect(result.identity.version).toBe(`1.18.18-dev-${headCommit.slice(0, 10)}`)
    expect(result.adapter).toBe(adapter11818)
    expect(events).toContain(`git:rev-parse ${adapter11818.tag}^{}`)
    expect(events.at(-1)).toBe("snapshot")
  })

  test("baseline tag 指向未知 commit 时在快照和构建阶段之前由 preflight 拒绝", async () => {
    const events: string[] = []
    await expectFailure(
      preflightBuild(["--channel", "dev"], {
        git: gitFixture(events, { dirty: "", commit: adapter11818.commit, baselineTagCommit: "0".repeat(40) }),
        repositoryRoot: "D:/fixture/repository",
        verifySnapshot: async () => {
          events.push("snapshot")
          return { frameworkVersion: 1, files: {} }
        },
      }),
      /受信基线 tag/,
    )
    expect(events).not.toContain("snapshot")
  })

  test("baseline tag 缺失时在快照和构建阶段之前由 preflight 拒绝", async () => {
    const events: string[] = []
    await expectFailure(
      preflightBuild(["--channel", "dev"], {
        git: gitFixture(events, { dirty: "", commit: adapter11818.commit, baselineTagCommit: null }),
        repositoryRoot: "D:/fixture/repository",
        verifySnapshot: async () => {
          events.push("snapshot")
          return { frameworkVersion: 1, files: {} }
        },
      }),
      /无法读取受信基线 tag/,
    )
    expect(events).not.toContain("snapshot")
  })

  test("未知 Desktop version 在快照和构建阶段之前由 preflight 拒绝", async () => {
    const events: string[] = []
    await expectFailure(
      preflightBuild(["--channel", "dev"], {
        git: gitFixture(events, { dirty: "", commit: adapter11818.commit, desktopVersion: "9.99.99" }),
        repositoryRoot: "D:/fixture/repository",
        verifySnapshot: async () => {
          events.push("snapshot")
          return { frameworkVersion: 1, files: {} }
        },
      }),
      /未注册/,
    )
    expect(events).not.toContain("snapshot")
  })

  test("prod 在 fetch 后、重活前不消费 ignored overlay 但仍认证 tracked source", async () => {
    const events: string[] = []
    await preflightBuild(["--channel", "prod", "--release", "260815-02"], {
      git: gitFixture(events, {
        dirty: "",
        commit: adapter11818.commit,
        overlay: "packages/opencode/script/build-config.ts\n",
        tags: "bluedcode-v1.18.17-260815-01\n",
      }),
      repositoryRoot: "D:/fixture/repository",
      verifySnapshot: async () => {
        events.push("snapshot")
        return { frameworkVersion: 1, files: {} }
      },
    })
    expect(events.slice(0, 2)).toEqual(["git:fetch --tags", "git:tag --list bluedcode-v*"])
    expect(events.some((event) => event.includes("ls-files --others --ignored"))).toBe(false)
    expect(events.at(-1)).toBe("snapshot")
  })
})

test("唯一 CLI 在预检失败时返回非零退出码", () => {
  const result = Bun.spawnSync(
    [process.execPath, path.resolve(import.meta.dir, "../build.ts"), "--channel", "invalid"],
    {
      cwd: repositoryRoot(),
      stdout: "pipe",
      stderr: "pipe",
    },
  )

  expect(result.exitCode).toBe(1)
  expect(result.stderr.toString()).toContain("--channel 只能是 dev 或 prod")
})

test("Task 7 按 Task 6 默认路径顺序认证 output audit", async () => {
  const root = await temporaryRoot("bluedcode-output-evidence-")
  const paths = createBuildPaths(devIdentity(), root)
  const outputRoot = path.join(paths.stageDir, "desktop", "out")
  const auditRoot = path.join(paths.stageDir, "electron-vite", "audits")
  const files = ["renderer/assets/a-.js", "renderer/assets/a_.js"]
  await Promise.all(files.map((file) => writeFixture(path.join(outputRoot, ...file.split("/")), file)))
  const artifacts = await Promise.all(
    files.sort().map(async (file) => {
      const bytes = await readFile(path.join(outputRoot, ...file.split("/")))
      return {
        file,
        size: bytes.byteLength,
        digest: createHash("sha256").update(bytes).digest("hex"),
      }
    }),
  )
  await writeFixture(
    path.join(auditRoot, `output-audit-${"a".repeat(64)}.json`),
    `${JSON.stringify({ version: 1, topLevel: ["main", "preload", "renderer"], artifacts }, null, 2)}\n`,
  )

  expect(await verifyElectronViteEvidence(paths)).toBeUndefined()
})

test("release-manifest exact schema 记录完整 commit、摘要、账本、审计与 SmartScreen 限制", () => {
  const manifest = manifestFixture(Buffer.from("portable-exe"))

  expect(manifest.enterprise.policy.providerMode).toBe("admin-static-only")
  expect(manifest.enterprise.audit.passed).toBe(true)
  expect(manifest.enterprise.policy.blockedPublicShare).toBe(true)

  expect(manifest).toEqual({
    schemaVersion: 1,
    product: {
      name: "BluedCode Dev",
      appId: "ai.bluedcode.desktop.dev",
      protocol: "bluedcode-dev",
      channel: "dev",
      platform: "win32",
      arch: "x64",
    },
    baseline: {
      tag: "v1.18.18",
      commit: "31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d",
      desktopVersion: "1.18.18",
    },
    build: {
      version: "1.18.18-dev-0123456789",
      commit: "0123456789abcdef0123456789abcdef01234567",
      shortCommit: "0123456789",
      builtAtUtc: "2026-08-15T01:02:03.000Z",
      source: { before: sourceStateFixture(), after: sourceStateFixture() },
      tools: {
        bun: "1.3.14",
        electron: "42.3.3",
        electronBuilder: "26.15.2",
        appBuilderLib: "26.15.2",
        electronVite: "5.0.0",
        resedit: "1.7.2",
        sevenZip: "26.02",
      },
      digests: {
        framework: "b".repeat(64),
        adapter: "c".repeat(64),
        assets: "d".repeat(64),
      },
      cache: {
        server: true,
        electronVite: false,
        portable: false,
        portableExtractorTool: true,
      },
    },
    release: { targetTag: null, annotatedTagCommand: null },
    artifact: {
      file: "BluedCode-Dev-1.18.18-dev-0123456789-windows-x64-portable.exe",
      format: "portable",
      size: 12,
      sha256: "167d99332652b0dd0f4911ef1dd8b23ef42fb64badf16708403cc94bf390c8b1",
      unsigned: true,
      smartScreen: "Windows SmartScreen 可能显示“未知发布者”",
    },
    transformation: {
      ledger: {
        version: 2,
        events: [
          {
            stage: "main",
            moduleId: "locale:desktop-native:main",
            file: "packages/app/src/i18n/desktop-native.ts",
            inputSha256: "a".repeat(64),
            outputSha256: "b".repeat(64),
            rules: [],
            productProfileSha256: "c".repeat(64),
          },
        ],
      },
      sha256: "e".repeat(64),
    },
    enterprise: {
      policy: {
        enabled: true,
        providerMode: "admin-static-only",
        blockedAuthWrites: true,
        blockedPublicShare: true,
        blockedPublicCatalogRefresh: true,
        blockedTelemetry: true,
        blockedPublicUpdates: true,
        blockedPublicProductLinks: true,
      },
      audit: {
        scannedFiles: ["main/index.js"],
        allowed: [],
        unclassified: [],
        passed: true,
      },
    },
    audit: {
      output: {
        scannedFiles: ["main/index.js"],
        allowed: [],
        unclassified: [],
        passed: true,
      },
      package: {
        asarFiles: ["out/main/index.js", "package.json"],
        unpackedFiles: [],
        nativeExecutables: ["node_modules/@lydell/node-pty-win32-x64/prebuilds/win32-x64/conpty/OpenConsole.exe"],
        bannedEntrypoints: [],
        passed: true,
      },
      pe: {
        productName: "BluedCode Dev",
        productVersion: "1.18.18-dev-0123456789",
        fileVersion: "1.18.18-dev-0123456789",
        numericFileVersion: "0.0.0.0",
        numericProductVersion: "0.0.0.0",
        signatureStatus: "NotSigned",
        passed: true,
      },
      portable: portableAuditFixture(),
      runtime: {
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
        adminConfig: {
          apiKeySha256: "be1a186ad5399278bd0942db2185028509cd423bf6635b3ac76667935504b1ba",
          modelId: "gpt-4.1",
          providerId: "openai-proxy",
        },
        publicNetworkCalls: [],
        checks: {
          defaultSessionCore: "v1",
          sessionCoreSwitchesTo: "v2",
          deepLinkRefresh: { moved: true, refreshed: true },
          disabledEntrypoints: ["auth", "connect-provider", "share", "update"],
          staleSession: {
            appShellLoaded: true,
            recoveryError: { code: "SESSION_NOT_FOUND", message: "Session not found: stale-session" },
          },
        },
        logs: {
          stdoutSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          stderrSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
      },
      releaseDirectory: {
        files: ["BluedCode-Dev-1.18.18-dev-0123456789-windows-x64-portable.exe", "release-manifest.json"],
        passed: true,
      },
    },
  })
  expect(serializeReleaseManifest(manifest)).toBe(`${JSON.stringify(manifest, null, 2)}\n`)
  expect(() =>
    serializeReleaseManifest({
      ...manifest,
      enterprise: { ...manifest.enterprise, policy: { ...manifest.enterprise.policy, enabled: false } },
    }),
  ).toThrow("企业策略必须由产品 Profile 派生")
})

test("manifest cache 语义区分 Portable 重打与提取工具缓存并锁定 exact schema", () => {
  const mutations: Array<(cache: ReleaseManifestInput["cache"]) => void> = [
    (cache) => void Reflect.set(cache, "portable", true),
    (cache) => void Reflect.set(cache, "portableExtractorTool", false),
    (cache) => void Reflect.set(cache, "unexpected", true),
  ]
  for (const mutate of mutations) {
    const invalid: ReleaseManifestInput["cache"] = {
      server: true,
      electronVite: false,
      portable: false,
      portableExtractorTool: true,
    }
    mutate(invalid)
    expect(() => manifestFixture(Buffer.from("portable-exe"), invalid)).toThrow(/cache/i)
  }
})

test("manifest runtime portable 证据要求无主进程错误、V1/V2、受限入口和零公网调用", () => {
  const manifest = manifestFixture(Buffer.from("portable-exe"))
  Reflect.set(manifest.audit, "runtime", {
    mode: "portable",
    visibleVersion: "1.18.18-dev-0123456789",
    executableStarted: true,
    serverHealthReady: true,
    preloadReady: true,
    rendererReady: true,
    adminModelLoaded: true,
    exitedCleanly: true,
    lingeringProcesses: [],
    configDirectory: ".config/bluedcode",
    mainProcessError: "ReferenceError",
    publicNetworkCalls: [],
    checks: {
      defaultSessionCore: "v1",
      sessionCoreSwitchesTo: "v2",
      deepLinkRefresh: { moved: true, refreshed: true },
      disabledEntrypoints: ["auth", "connect-provider", "share", "update"],
    },
  })

  expect(() => serializeReleaseManifest(manifest)).toThrow(/runtime|运行时|主进程/i)
})

test("manifest runtime portable 缺失或伪造 stale-session recovery 证据时 fail closed", () => {
  const manifest = manifestFixture(Buffer.from("portable-exe"))
  Reflect.set(manifest.audit.runtime.checks, "staleSession", { appShellLoaded: true })

  expect(() => serializeReleaseManifest(manifest)).toThrow(/runtime|stale|session|恢复/i)
})

test("manifest runtime portable 拒绝错误的 stale-session recovery code 或 message", () => {
  for (const recoveryError of [
    { code: "SESSION_OTHER", message: "Session not found: stale-session" },
    { code: "SESSION_NOT_FOUND", message: "Session not found: another-session" },
  ]) {
    const manifest = manifestFixture(Buffer.from("portable-exe"))
    Reflect.set(manifest.audit.runtime.checks, "staleSession", { appShellLoaded: true, recoveryError })

    expect(() => serializeReleaseManifest(manifest)).toThrow(/runtime|stale|session|恢复/i)
  }
})

test("manifest runtime 拒绝 source-only fixture 与明文管理员 API key", () => {
  const fixtureManifest = manifestFixture(Buffer.from("portable-exe"))
  Reflect.set(fixtureManifest.audit, "runtime", {
    fixtureConfigDirectory: ".config/bluedcode",
    mode: "fixture",
    visibleVersion: "1.18.18-dev-0123456789",
    smoke: {
      appShellLoaded: true,
      defaultSessionCore: "v1",
      deepLinkRefresh: { moved: true, refreshed: true },
      disabledEntrypoints: ["auth", "connect-provider", "share", "update"],
      loadedModel: "openai-proxy/gpt-4.1",
      publicNetworkCalls: [],
      sessionCoreSwitchesTo: "v2",
    },
    staleSession: {
      appShellLoaded: true,
      recoveryError: { code: "SESSION_NOT_FOUND", message: "Session not found: stale-session" },
    },
  })
  expect(() => serializeReleaseManifest(fixtureManifest)).toThrow(/runtime|Portable|fixture/i)

  const secretManifest = manifestFixture(Buffer.from("portable-exe"))
  Reflect.set(secretManifest.audit.runtime, "adminConfig", {
    apiKey: "sk-runtime-acceptance-secret",
    modelId: "gpt-4.1",
    providerId: "openai-proxy",
  })
  expect(() => serializeReleaseManifest(secretManifest)).toThrow(/runtime|secret|密钥|明文/i)

  const nestedSecretManifest = manifestFixture(Buffer.from("portable-exe"))
  Reflect.set(nestedSecretManifest.audit.runtime, "extra", { api_key: "sk-real-secret-example" })
  Reflect.set(nestedSecretManifest.audit.runtime.checks, "token", "internal-token")
  expect(() => serializeReleaseManifest(nestedSecretManifest)).toThrow(/runtime|secret|密钥|明文|schema/i)
})

test("manifest 与已认证 resedit 完整图摘要和文件清单精确交叉验证", () => {
  const mutations: Array<(tool: typeof resourceEditorLock) => void> = [
    (tool) => void Reflect.set(tool, "graphSha256", "0".repeat(64)),
    (tool) => void Reflect.set(tool.packages[0].files[0], "sha256", "0".repeat(64)),
  ]
  for (const mutate of mutations) {
    const tampered = structuredClone(resourceEditorLock)
    mutate(tampered)
    expect(() => manifestFixture(Buffer.from("portable-exe"), undefined, tampered)).toThrow(/资源编辑工具|目标无效/)
  }
})

test("EXE 与 manifest 以内容寻址目录原子发布且目录中只有两个普通文件", async () => {
  const root = await temporaryRoot("bluedcode-release-")
  const outputRoot = path.join(root, ".xcode", "bluedcode")
  const artifactsRoot = path.join(outputRoot, "artifacts")
  const executable = path.join(outputRoot, "candidate.exe")
  const bytes = Buffer.from("portable-exe")
  await mkdir(artifactsRoot, { recursive: true })
  await writeFile(executable, bytes)

  const result = await publishRelease({
    artifactsRoot,
    executable,
    manifest: manifestFixture(bytes),
    outputRoot,
    repositoryRoot: root,
  })
  const second = await publishRelease({
    artifactsRoot,
    executable,
    manifest: manifestFixture(bytes),
    outputRoot,
    repositoryRoot: root,
  })

  expect(second).toEqual(result)
  expect(path.basename(result.directory)).toMatch(/^[a-f0-9]{64}$/)
  expect((await readdir(result.directory)).sort()).toEqual([
    "BluedCode-Dev-1.18.18-dev-0123456789-windows-x64-portable.exe",
    "release-manifest.json",
  ])
  for (const file of await readdir(result.directory)) {
    const stats = await lstat(path.join(result.directory, file))
    expect(stats.isFile()).toBe(true)
    expect(stats.isSymbolicLink()).toBe(false)
  }
})

test("预置 artifacts junction 时拒绝发布且外部 sentinel 不变", async () => {
  if (process.platform !== "win32") return
  const root = await temporaryRoot("bluedcode-release-junction-")
  const external = await temporaryRoot("bluedcode-release-external-")
  const outputRoot = path.join(root, ".xcode", "bluedcode")
  const artifactsRoot = path.join(outputRoot, "artifacts")
  const executable = path.join(outputRoot, "candidate.exe")
  const sentinel = path.join(external, "sentinel.txt")
  const bytes = Buffer.from("portable-exe")
  await mkdir(outputRoot, { recursive: true })
  await Promise.all([writeFile(executable, bytes), writeFile(sentinel, "do-not-touch")])
  await symlink(external, artifactsRoot, "junction")

  await expectFailure(
    publishRelease({
      artifactsRoot,
      executable,
      manifest: manifestFixture(bytes),
      outputRoot,
      repositoryRoot: root,
    }),
    /链接|junction/i,
  )
  expect(await readFile(sentinel, "utf8")).toBe("do-not-touch")
})

test("隔离 package 输入只写 stage，并验证 node-pty Windows x64 运行时精确白名单", async () => {
  const root = await temporaryRoot("bluedcode-package-input-")
  const identity = devIdentity()
  const paths = createBuildPaths(identity, root)
  const nativePackageDir = path.join(root, "native")
  const upstreamPackage = path.join(root, "packages", "desktop", "package.json")
  await Promise.all([
    mkdir(path.dirname(upstreamPackage), { recursive: true }),
    mkdir(nativePackageDir, { recursive: true }),
  ])
  await writeFile(upstreamPackage, '{"name":"upstream","version":"1.18.18"}\n')
  await Promise.all(
    nativeRuntimeFiles.map(async (file) => {
      const target = path.join(nativePackageDir, ...file.split("/"))
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(
        target,
        file === "package.json"
          ? '{"name":"@lydell/node-pty-win32-x64","version":"1.2.0-beta.12","os":["win32"],"cpu":["x64"]}\n'
          : file.endsWith(".js")
            ? "module.exports = {}\n"
            : new Uint8Array([0, 1, 2, 3]),
      )
    }),
  )
  const before = await readFile(upstreamPackage, "utf8")

  const result = await preparePackagingInput(paths, identity, nativePackageDir)

  expect(JSON.parse(await readFile(result.packageFile, "utf8"))).toEqual({
    main: "out/main/index.js",
    name: "bluedcode-build-input",
    private: true,
    type: "module",
    version: "1.18.18",
  })
  expect(await readFile(upstreamPackage, "utf8")).toBe(before)
  expect(result.nativeFiles).toEqual(nativeRuntimeFiles)
  expect(result.nativeManifest).toEqual({
    version: 1,
    packageName: "@lydell/node-pty-win32-x64",
    packageVersion: "1.2.0-beta.12",
    files: await Promise.all(
      nativeRuntimeFiles.map(async (file) => {
        const bytes = await readFile(path.join(nativePackageDir, ...file.split("/")))
        return {
          file,
          size: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        }
      }),
    ),
  })
  expect(JSON.parse(await readFile(result.nativeManifestFile, "utf8"))).toEqual(result.nativeManifest)
  expect(path.dirname(result.nativeManifestFile)).not.toBe(result.packageDir)
  for (const file of nativeRuntimeFiles) {
    expect(
      await readFile(path.join(result.packageDir, "node_modules", "@lydell", "node-pty-win32-x64", ...file.split("/"))),
    ).toEqual(await readFile(path.join(nativePackageDir, ...file.split("/"))))
  }
  await rm(path.join(nativePackageDir, "prebuilds", "win32-x64", "conpty.node"))
  await expectFailure(preparePackagingInput(paths, identity, nativePackageDir), /conpty\.node/)
})

test("Electron output 只接受 main/preload/renderer 且拒绝额外 CLI/Web/TUI 可执行面", async () => {
  const root = await temporaryRoot("bluedcode-output-audit-")
  await Promise.all([
    writeFixture(path.join(root, "main", "index.js"), "export const app = 'BluedCode'\n"),
    writeFixture(path.join(root, "preload", "index.js"), "module.exports = {}\n"),
    writeFixture(path.join(root, "renderer", "index.html"), "<title>BluedCode</title>\n"),
  ])

  expect(await auditElectronOutput(root, { tokens: [], allow: [] })).toMatchObject({ passed: true })
  await writeFixture(path.join(root, "renderer", "opencode-cli.exe"), "cli")
  await expectFailure(auditElectronOutput(root, { tokens: [], allow: [] }), /CLI|可执行|exe/i)
})

test("Electron output 保留内嵌 server OAuth client ID 但不把它当成 CLI 可执行面", async () => {
  const root = await temporaryRoot("bluedcode-output-internal-identity-")
  await Promise.all([
    writeFixture(path.join(root, "main", "index.js"), 'const clientId = "opencode-cli"\n'),
    writeFixture(path.join(root, "preload", "index.js"), "module.exports = {}\n"),
    writeFixture(path.join(root, "renderer", "index.html"), "<title>BluedCode</title>\n"),
  ])

  expect(await auditElectronOutput(root, { tokens: [], allow: [] })).toMatchObject({ passed: true })
})

test("Electron output 对未分类 OpenCode 品牌残留 fail closed", async () => {
  const root = await temporaryRoot("bluedcode-output-opencode-audit-")
  const policy = {
    tokens: ["OpenCode"],
    allow: [
      {
        id: "service",
        path: "renderer/assets/*.js",
        token: "OpenCode",
        expected: "any" as const,
        classification: "preserved" as const,
        reason: "服务身份",
      },
    ],
  }
  await Promise.all([
    writeFixture(path.join(root, "main", "index.js"), "export const app = 'BluedCode'\n"),
    writeFixture(path.join(root, "preload", "index.js"), "module.exports = {}\n"),
    writeFixture(path.join(root, "renderer", "index.html"), "<title>BluedCode</title>\n"),
    writeFixture(path.join(root, "renderer", "assets", "service.js"), "const service = 'OpenCode Zen'\n"),
  ])

  expect(await auditElectronOutput(root, policy)).toMatchObject({
    passed: true,
  })
  await writeFixture(path.join(root, "renderer", "brand.js"), "document.title = 'OpenCode Desktop'\n")
  await expectFailure(auditElectronOutput(root, policy), /品牌审计|OpenCode/i)
})

test("Electron output 对企业受限公共能力令牌 fail closed", async () => {
  const root = await temporaryRoot("bluedcode-output-enterprise-audit-")
  await Promise.all([
    writeFixture(path.join(root, "main", "index.js"), "export const app = 'BluedCode'\n"),
    writeFixture(path.join(root, "preload", "index.js"), "module.exports = {}\n"),
    writeFixture(path.join(root, "renderer", "index.html"), "<title>BluedCode</title>\n"),
  ])

  const enterpriseTokens = [
    "SENTRY_DSN",
    "updater-check",
    "github.com/anomalyco/opencode",
    "shareNext.create",
    "method.authorize(",
  ]
  const policy = {
    tokens: adapter11818.auditPolicy.tokens.filter((token) => enterpriseTokens.includes(token)),
    allow: [],
  }
  for (const token of enterpriseTokens) {
    await writeFixture(path.join(root, "renderer", "enterprise.js"), token)
    await expectFailure(auditElectronOutput(root, policy), /品牌审计|未分类/i)
  }
})

test("Electron output 将已声明的 fail-closed CLI/WSL 协议交给输出审计逐项认证", async () => {
  const root = await temporaryRoot("bluedcode-output-disabled-protocol-")
  await Promise.all([
    writeFixture(path.join(root, "main", "index.js"), 'const channel = "wsl-servers-install-start"\n'),
    writeFixture(path.join(root, "preload", "index.js"), 'const channel = "install-cli"\n'),
    writeFixture(path.join(root, "renderer", "index.html"), "<title>BluedCode</title>\n"),
  ])
  const policy = {
    tokens: ["wsl-servers-install-", '"install-cli"'],
    allow: [
      {
        id: "main-fail-closed-wsl",
        path: "main/index.js",
        token: "wsl-servers-install-",
        expected: "any" as const,
        classification: "evidence" as const,
        reason: "测试已声明的 fail-closed WSL 协议。",
      },
      {
        id: "preload-fail-closed-cli",
        path: "preload/index.js",
        token: '"install-cli"',
        expected: "any" as const,
        classification: "evidence" as const,
        reason: "测试已声明的 fail-closed CLI 协议。",
      },
    ],
  }
  await expect(auditElectronOutput(root, policy)).resolves.toMatchObject({ passed: true })
})

test("Electron output 拒绝未随包携带的裸运行时依赖", async () => {
  const root = await temporaryRoot("bluedcode-output-runtime-import-")
  await Promise.all([
    writeFixture(path.join(root, "main", "index.js"), 'import { Effect } from "effect"\n'),
    writeFixture(path.join(root, "preload", "index.js"), "module.exports = {}\n"),
    writeFixture(path.join(root, "renderer", "index.html"), "<title>BluedCode</title>\n"),
  ])

  await expectFailure(auditElectronOutput(root, { tokens: [], allow: [] }), /裸运行时依赖.*effect/i)
})

test("Electron output 拒绝 CommonJS require 和动态 import 裸依赖", async () => {
  const root = await temporaryRoot("bluedcode-output-runtime-cjs-")
  await Promise.all([
    writeFixture(path.join(root, "main", "index.js"), 'const effect = require("effect")\n'),
    writeFixture(path.join(root, "preload", "index.js"), 'await import("parse-duration")\n'),
    writeFixture(path.join(root, "renderer", "index.html"), "<title>BluedCode</title>\n"),
  ])

  await expectFailure(auditElectronOutput(root, { tokens: [], allow: [] }), /裸运行时依赖.*effect.*parse-duration/i)
})

test("Electron output 不把已打包代码字符串误判为裸运行时依赖", async () => {
  const root = await temporaryRoot("bluedcode-output-runtime-string-")
  await Promise.all([
    writeFixture(
      path.join(root, "main", "index.js"),
      [
        'import electron from "electron"',
        "const typeSource = 'import type { Plugin } from \"@opencode-ai/plugin\"'",
        "const generated = `const Serializer = require('fast-json-stringify/lib/serializer')`",
      ].join("\n"),
    ),
    writeFixture(path.join(root, "preload", "index.js"), "module.exports = {}\n"),
    writeFixture(path.join(root, "renderer", "index.html"), "<title>BluedCode</title>\n"),
  ])

  expect(await auditElectronOutput(root, { tokens: [], allow: [] })).toMatchObject({ passed: true })
})

test("ASAR unpack 的 header、磁盘与预声明 17 项 native manifest 三方精确一致", async () => {
  const root = await temporaryRoot("bluedcode-asar-audit-")
  const source = path.join(root, "source")
  const archive = path.join(root, "app.asar")
  const nativePrefix = "node_modules/@lydell/node-pty-win32-x64"
  const files = [
    "package.json",
    "out/main/index.js",
    "out/preload/index.js",
    "out/renderer/index.html",
    ...nativeRuntimeFiles.map((file) => `${nativePrefix}/${file}`),
  ]
  await Promise.all(
    files.map((file) =>
      writeFixture(
        path.join(source, ...file.split("/")),
        /\.(?:dll|exe|node)$/.test(file) ? new Uint8Array([77, 90, 0, file.length]) : file,
      ),
    ),
  )
  const nativeManifest: NativeRuntimeManifest = {
    version: 1,
    packageName: "@lydell/node-pty-win32-x64",
    packageVersion: "1.2.0-beta.12",
    files: await Promise.all(
      nativeRuntimeFiles.map(async (file) => {
        const bytes = await readFile(path.join(source, nativePrefix, ...file.split("/")))
        return {
          file,
          size: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        }
      }),
    ),
  }
  const asarCli = resolveAsarCli()
  const packed = Bun.spawnSync([process.execPath, asarCli, "pack", source, archive, "--unpack-dir", nativePrefix])
  expect(packed.exitCode, packed.stderr.toString()).toBe(0)

  expect(await auditAsarContents(archive, files, nativeManifest)).toEqual({
    asarFiles: [...files].sort(),
    unpackedFiles: nativeRuntimeFiles.map((file) => `${nativePrefix}/${file}`).sort(),
    nativeExecutables: ["node_modules/@lydell/node-pty-win32-x64/prebuilds/win32-x64/conpty/OpenConsole.exe"],
    bannedEntrypoints: [],
    passed: true,
  })
  await expectFailure(auditAsarContents(archive, files.slice(0, -1), nativeManifest), /文件集合/)

  const unpackedRoot = `${archive}.unpacked`
  const tampered = path.join(unpackedRoot, nativePrefix, "prebuilds", "win32-x64", "conpty.node")
  const original = await readFile(tampered)
  await writeFile(tampered, Buffer.from("tampered-native"))
  await expectFailure(
    auditAsarContents(archive, files, nativeManifest),
    /conpty\.node.*(?:摘要|大小)|(?:摘要|大小).*conpty\.node/,
  )
  await writeFile(tampered, original)
  await writeFixture(path.join(unpackedRoot, nativePrefix, "unexpected.node"), new Uint8Array([77, 90]))
  await expectFailure(auditAsarContents(archive, files, nativeManifest), /unpacked.*集合|unexpected\.node/i)
})

test("ASAR packed 应用代码和品牌资源必须匹配打包前审计摘要", async () => {
  const root = await temporaryRoot("bluedcode-asar-packed-digest-")
  const source = path.join(root, "source")
  const archive = path.join(root, "app.asar")
  const nativePrefix = "node_modules/@lydell/node-pty-win32-x64"
  const packedFiles = [
    ["package.json", '{"name":"bluedcode-desktop","version":"1.18.18","main":"out/main/index.js"}\n'],
    ["out/main/index.js", "console.log('BluedCode main')\n"],
    ["out/preload/index.js", "console.log('BluedCode preload')\n"],
    ["out/renderer/index.html", "<title>BluedCode</title>\n"],
    ["assets/favicon.svg", "<svg></svg>\n"],
  ] as const
  await Promise.all([
    ...packedFiles.map(([file, content]) => writeFixture(path.join(source, ...file.split("/")), content)),
    ...nativeRuntimeFiles.map((file) =>
      writeFixture(path.join(source, nativePrefix, ...file.split("/")), new Uint8Array([77, 90, file.length])),
    ),
  ])
  const nativeManifest: NativeRuntimeManifest = {
    version: 1,
    packageName: "@lydell/node-pty-win32-x64",
    packageVersion: "1.2.0-beta.12",
    files: await Promise.all(
      nativeRuntimeFiles.map(async (file) => {
        const bytes = await readFile(path.join(source, nativePrefix, ...file.split("/")))
        return {
          file,
          size: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        }
      }),
    ),
  }
  const expected = await Promise.all(
    [...packedFiles.map(([file]) => file), ...nativeRuntimeFiles.map((file) => `${nativePrefix}/${file}`)].map(
      async (file) => {
        const bytes = await readFile(path.join(source, ...file.split("/")))
        return {
          file,
          size: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        }
      },
    ),
  )
  const asarCli = resolveAsarCli()
  const packed = Bun.spawnSync([process.execPath, asarCli, "pack", source, archive, "--unpack-dir", nativePrefix])
  expect(packed.exitCode, packed.stderr.toString()).toBe(0)
  await writeFixture(path.join(source, "out", "main", "index.js"), "console.log('tampered')\n")
  await rm(archive, { force: true })
  const repacked = Bun.spawnSync([process.execPath, asarCli, "pack", source, archive, "--unpack-dir", nativePrefix])
  expect(repacked.exitCode, repacked.stderr.toString()).toBe(0)

  await expectFailure(
    auditAsarContents(archive, expected, nativeManifest),
    /packed.*(?:大小|摘要).*out\/main\/index\.js/i,
  )
})

test("ASAR package.json 期望匹配 Electron Builder extraMetadata 输出", () => {
  expect(createAsarPackageJson(devIdentity())).toBe(
    JSON.stringify(
      {
        main: "out/main/index.js",
        name: "bluedcode-desktop-dev",
        private: true,
        type: "module",
        version: "1.18.18-dev-0123456789",
        author: { name: "ForeachCode" },
        description: "BluedCode Windows Desktop",
        productName: "BluedCode Dev",
      },
      null,
      2,
    ),
  )
})

test("Builder 工作目录只接受精确 Portable EXE，不接受 zip、MSI 或第二个 EXE", async () => {
  const root = await temporaryRoot("bluedcode-builder-artifact-")
  const artifactName = "BluedCode-Dev-1.18.18-dev-0123456789-windows-x64-portable.exe"
  await Promise.all([
    writeFixture(path.join(root, artifactName), new Uint8Array([77, 90])),
    mkdir(path.join(root, "win-unpacked")),
  ])

  expect(await findPortableArtifact(root, artifactName)).toBe(path.join(root, artifactName))
  await writeFile(path.join(root, "extra.zip"), "forbidden")
  await expectFailure(findPortableArtifact(root, artifactName), /zip|额外/i)
  await rm(path.join(root, "extra.zip"))
  await writeFile(path.join(root, "second.exe"), "forbidden")
  await expectFailure(findPortableArtifact(root, artifactName), /EXE|额外/i)
})

test("win-unpacked 只允许品牌应用与 node-pty OpenConsole，不允许 Builder elevate helper", () => {
  const identity = devIdentity()
  const openConsole =
    "resources/app.asar.unpacked/node_modules/@lydell/node-pty-win32-x64/prebuilds/win32-x64/conpty/OpenConsole.exe"

  expect(validateWinUnpackedExecutables([`${identity.name}.exe`, openConsole], identity)).toEqual([
    `${identity.name}.exe`,
    openConsole,
  ])
  expect(() =>
    validateWinUnpackedExecutables([`${identity.name}.exe`, openConsole, "resources/elevate.exe"], identity),
  ).toThrow(/elevate|CLI|TUI|EXE/i)
})

test("锁定 electron-builder class API 通过 programmatic loader 门禁", async () => {
  const desktop = path.join(repositoryRoot(), "packages", "desktop")
  const moduleFile = Bun.resolveSync("electron-builder", desktop)
  const loaded: unknown = await import(pathToFileURL(moduleFile).href)

  expect(loaded && typeof loaded === "object" && "Platform" in loaded && typeof loaded.Platform).toBe("function")
  expect(isElectronBuilderModule(loaded)).toBe(true)
})

test("electron-builder 模块导入前必须清空发布和签名凭据", async () => {
  const root = await temporaryRoot("bluedcode-builder-env-")
  const moduleRoot = path.join(root, "fake-electron-builder")
  const moduleFile = path.join(moduleRoot, "index.mjs")
  const builderUtilFile = path.join(moduleRoot, "node_modules", "builder-util", "index.mjs")
  await writeFixture(
    moduleFile,
    [
      'if (process.env.GH_TOKEN) await Bun.write(new URL("./saw-secret.txt", import.meta.url), process.env.GH_TOKEN)',
      'export const Arch = { x64: "x64" }',
      "export const Platform = { WINDOWS: { createTarget: () => ({}) } }",
      'export async function build() { return ["BluedCode-Dev-1.18.18-dev-0123456789-windows-x64-portable.exe"] }',
    ].join("\n"),
  )
  await writeFixture(
    builderUtilFile,
    'export function debug() {}\nObject.defineProperty(debug, "enabled", { value: undefined, writable: true })\n',
  )
  const paths = createBuildPaths(devIdentity(), root)
  const config = builderConfigFixture(paths, root)
  const previous = process.env.GH_TOKEN
  process.env.GH_TOKEN = "secret-token"
  try {
    await packagePortable(paths, config, devIdentity(), moduleFile)
    expect(await Bun.file(path.join(moduleRoot, "saw-secret.txt")).exists()).toBe(false)
    expect(process.env.GH_TOKEN).toBe("secret-token")
  } finally {
    if (previous === undefined) delete process.env.GH_TOKEN
    else process.env.GH_TOKEN = previous
  }
})

test("electron-builder cwd 副作用只能落入 owned workspace，不能改写仓库根 package.json", async () => {
  const root = await temporaryRoot("bluedcode-builder-cwd-")
  const moduleRoot = path.join(root, "fake-electron-builder-cwd")
  const moduleFile = path.join(moduleRoot, "index.mjs")
  const builderUtilFile = path.join(moduleRoot, "node_modules", "builder-util", "index.mjs")
  await writeFixture(
    moduleFile,
    [
      'export const Arch = { x64: "x64" }',
      "export const Platform = { WINDOWS: { createTarget: () => ({}) } }",
      "export async function build() {",
      '  await Bun.write("package.json", JSON.stringify({ name: "builder-side-effect" }))',
      '  return ["BluedCode-Dev-1.18.18-dev-0123456789-windows-x64-portable.exe"]',
      "}",
    ].join("\n"),
  )
  await writeFixture(
    builderUtilFile,
    'export function debug() {}\nObject.defineProperty(debug, "enabled", { value: undefined, writable: true })\n',
  )
  const paths = createBuildPaths(devIdentity(), root)
  const repositoryPackage = path.join(root, "package.json")
  await writeFixture(repositoryPackage, '{"name":"repository"}\n')

  const originalCwd = process.cwd()
  try {
    process.chdir(root)
    await packagePortable(paths, builderConfigFixture(paths, root), devIdentity(), moduleFile)
  } finally {
    process.chdir(originalCwd)
  }

  expect(await readFile(repositoryPackage, "utf8")).toBe('{"name":"repository"}\n')
  expect(JSON.parse(await readFile(path.join(paths.workspaceRoot, "package.json"), "utf8"))).toEqual({
    name: "builder-side-effect",
  })
})

test("Bun 下显式关闭 Builder debug 副产物并在调用后恢复", async () => {
  const desktop = path.join(repositoryRoot(), "packages", "desktop")
  const moduleFile = Bun.resolveSync("electron-builder", desktop)
  const utilityFile = Bun.resolveSync("builder-util", moduleFile)
  const loaded: unknown = await import(pathToFileURL(utilityFile).href)
  if (!loaded || typeof loaded !== "object" || !("debug" in loaded) || typeof loaded.debug !== "function") {
    throw new Error("锁定 builder-util debug API 无效")
  }
  const original = Reflect.get(loaded.debug, "enabled")
  Reflect.set(loaded.debug, "enabled", undefined)
  try {
    expect(Reflect.get(loaded.debug, "enabled")).toBeUndefined()
    const restore = await forceElectronBuilderDebugOff(moduleFile)
    expect(Reflect.get(loaded.debug, "enabled")).toBe(false)
    restore()
    expect(Reflect.get(loaded.debug, "enabled")).toBeUndefined()
  } finally {
    Reflect.set(loaded.debug, "enabled", original)
  }
})

test("PowerShell PE 读取器报告真实 Electron 基础二进制未签名与四段数字版本", async () => {
  if (process.platform !== "win32") return
  const electron = path.join(
    repositoryRoot(),
    "packages",
    "desktop",
    "node_modules",
    "electron",
    "dist",
    "electron.exe",
  )
  const metadata = await readPeMetadata(electron)

  expect(metadata.productName).toBe("Electron")
  expect(metadata.signatureStatus).toBe("NotSigned")
  expect(metadata.numericFileVersion).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
  expect(metadata.numericProductVersion).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
})

test("Portable PE 合同要求完整 ProductVersion、独立数字版本与 unsigned", () => {
  const identity = devIdentity()
  const metadata = {
    productName: identity.name,
    productVersion: identity.version,
    fileVersion: identity.version,
    numericFileVersion: "0.0.0.0",
    numericProductVersion: "0.0.0.0",
    signatureStatus: "NotSigned",
  }

  expect(validatePortablePe(metadata, identity)).toEqual({
    ...metadata,
    signatureStatus: "NotSigned",
    passed: true,
  })
  expect(() => validatePortablePe({ ...metadata, productVersion: "1.18.18" }, identity)).toThrow("ProductVersion")
  expect(() => validatePortablePe({ ...metadata, numericFileVersion: "1.18.18.0" }, identity)).toThrow("数字版本")
  expect(() => validatePortablePe({ ...metadata, signatureStatus: "Valid" }, identity)).toThrow("unsigned")
})

function gitFixture(
  events: string[],
  options: {
    dirty: string
    overlay?: string
    tags?: string
    commit?: string
    tag?: string
    exactTag?: string | null
    baselineTagCommit?: string | null
    desktopVersion?: string
  },
): Git {
  return {
    async run(args) {
      events.push(`git:${args.join(" ")}`)
      const command = args.join(" ")
      if (command === "fetch --tags") return gitResult("")
      if (command === "tag --list bluedcode-v*") return gitResult(options.tags ?? "")
      const commit = options.commit ?? "0123456789abcdef0123456789abcdef01234567"
      if (command === "rev-parse HEAD") return gitResult(`${commit}\n`)
      if (command === "rev-parse --short=10 HEAD") return gitResult(`${commit.slice(0, 10)}\n`)
      if (command === "rev-parse --abbrev-ref HEAD") return gitResult("task-7\n")
      if (command === "describe --tags --exact-match HEAD") {
        if (options.exactTag === null) return gitFailure("no exact tag")
        return gitResult(`${options.exactTag ?? options.tag ?? "v1.18.18"}\n`)
      }
      if (command === `rev-parse ${adapter11818.tag}^{}`) {
        if (options.baselineTagCommit === null) return gitFailure("missing baseline tag")
        return gitResult(`${options.baselineTagCommit ?? adapter11818.commit}\n`)
      }
      if (command === "ls-files --stage -z") return gitResult("100644 abc 0\ttracked.ts\0")
      if (command === `ls-tree -r -z --full-tree ${commit}`) {
        return gitResult("100644 blob abc\ttracked.ts\0")
      }
      if (command === "show HEAD:packages/desktop/package.json")
        return gitResult(`{"version":"${options.desktopVersion ?? "1.18.18"}"}\n`)
      if (command === "status --porcelain=v1 -z --untracked-files=all") return gitResult(options.dirty)
      if (command.startsWith("ls-files --others --ignored")) return gitResult(options.overlay ?? "")
      return {
        exitCode: 1,
        stdout: "",
        stderr: `unexpected git command: ${command}`,
      }
    },
  }
}

function gitResult(stdout: string) {
  return { exitCode: 0, stdout, stderr: "" }
}

function gitFailure(stderr: string) {
  return { exitCode: 1, stdout: "", stderr }
}

function manifestFixture(
  executable: Buffer,
  cache = {
    server: true,
    electronVite: false,
    portable: false,
    portableExtractorTool: true,
  } satisfies ReleaseManifestInput["cache"],
  resourceEditTool = resourceEditorLock,
) {
  return createReleaseManifest({
    identity: {
      channel: "dev",
      name: "BluedCode Dev",
      appId: "ai.bluedcode.desktop.dev",
      protocol: "bluedcode-dev",
      version: "1.18.18-dev-0123456789",
      commit: "0123456789abcdef0123456789abcdef01234567",
      shortCommit: "0123456789",
      artifactName: "BluedCode-Dev-1.18.18-dev-0123456789-windows-x64-portable.exe",
    },
    baseline: {
      tag: "v1.18.18",
      commit: "31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d",
      desktopVersion: "1.18.18",
    },
    resourceEditorTool: resourceEditorLock,
    builtAtUtc: "2026-08-15T01:02:03.000Z",
    source: { before: sourceStateFixture(), after: sourceStateFixture() },
    tools: {
      bun: "1.3.14",
      electron: "42.3.3",
      electronBuilder: "26.15.2",
      appBuilderLib: "26.15.2",
      electronVite: "5.0.0",
      resedit: "1.7.2",
      sevenZip: "26.02",
    },
    digests: {
      framework: "b".repeat(64),
      adapter: "c".repeat(64),
      assets: "d".repeat(64),
    },
    cache,
    artifact: {
      size: executable.byteLength,
      sha256: createHash("sha256").update(executable).digest("hex"),
    },
    transformation: {
      ledger: {
        version: 2 as const,
        events: [
          {
            stage: "main" as const,
            moduleId: "locale:desktop-native:main",
            file: "packages/app/src/i18n/desktop-native.ts",
            inputSha256: "a".repeat(64),
            outputSha256: "b".repeat(64),
            rules: [],
            productProfileSha256: "c".repeat(64),
          },
        ],
      },
      sha256: "e".repeat(64),
    },
    enterprise: {
      audit: {
        scannedFiles: ["main/index.js"],
        allowed: [],
        unclassified: [],
        passed: true,
      },
    },
    audit: {
      output: {
        scannedFiles: ["main/index.js"],
        allowed: [],
        unclassified: [],
        passed: true,
      },
      package: {
        asarFiles: ["out/main/index.js", "package.json"],
        unpackedFiles: [],
        nativeExecutables: ["node_modules/@lydell/node-pty-win32-x64/prebuilds/win32-x64/conpty/OpenConsole.exe"],
        bannedEntrypoints: [],
        passed: true,
      },
      pe: {
        productName: "BluedCode Dev",
        productVersion: "1.18.18-dev-0123456789",
        fileVersion: "1.18.18-dev-0123456789",
        numericFileVersion: "0.0.0.0",
        numericProductVersion: "0.0.0.0",
        signatureStatus: "NotSigned",
        passed: true,
      },
      portable: portableAuditFixture(resourceEditTool),
      runtime: {
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
        adminConfig: {
          apiKeySha256: "be1a186ad5399278bd0942db2185028509cd423bf6635b3ac76667935504b1ba",
          modelId: "gpt-4.1",
          providerId: "openai-proxy",
        },
        publicNetworkCalls: [],
        checks: {
          defaultSessionCore: "v1",
          sessionCoreSwitchesTo: "v2",
          deepLinkRefresh: { moved: true, refreshed: true },
          disabledEntrypoints: ["auth", "connect-provider", "share", "update"],
          staleSession: {
            appShellLoaded: true,
            recoveryError: { code: "SESSION_NOT_FOUND", message: "Session not found: stale-session" },
          },
        },
        logs: {
          stdoutSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          stderrSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
      },
    },
    release: { targetTag: null, annotatedTagCommand: null },
  })
}

function sourceStateFixture() {
  return {
    branch: "task-7",
    head: "0123456789abcdef0123456789abcdef01234567",
    trackedContentSha256: "f".repeat(64),
    trackedIndexSha256: "a".repeat(64),
  }
}

function portableAuditFixture(resourceEditorTool = resourceEditorLock) {
  return {
    extractor: {
      version: "26.02" as const,
      cacheHit: true,
      cacheDirectory: "tool-cache/7zip-26.02",
      toolPath: "tool-cache/7zip-26.02/7z.exe",
      runner: {
        file: "7zr.exe" as const,
        url: "https://github.com/ip7z/7zip/releases/download/26.02/7zr.exe" as const,
        size: 602112,
        sha256: "56b8cc9f4971cef253644fafe54063ed7fdca551d4dee0f8c6baa81b855acd72" as const,
      },
      installer: {
        file: "7z2602-x64.exe" as const,
        url: "https://github.com/ip7z/7zip/releases/download/26.02/7z2602-x64.exe" as const,
        size: 1657896,
        sha256: "6745fa76dc2ea031596d8678f6f6b99c3c1b435b4164a63485adbbc7b8d82ef0" as const,
      },
      executable: {
        file: "7z.exe" as const,
        size: 576000,
        sha256: "83967f1b02b43c4efeda302795722c809e0e81b8307de73558d10484d5676a7d" as const,
      },
      library: {
        file: "7z.dll" as const,
        size: 1906688,
        sha256: "69fd4df057985c40e510e2fac182881c7f85e90aa13ec703f763a8fdb2ce61f8" as const,
      },
    },
    archive: {
      type: "Nsis" as const,
      method: "Deflate" as const,
      subtype: "NSIS-3 Unicode" as const,
    },
    controlPayload: [
      {
        file: "$PLUGINSDIR/StdUtils.dll",
        size: 102400,
        sha256: "b72e9013a6204e9f01076dc38dabbf30870d44dfc66962adbf73619d4331601e",
      },
      {
        file: "$PLUGINSDIR/System.dll",
        size: 12288,
        sha256: "3eb38ae99653a7dbc724132ee240f6e5c4af4bfe7c01d31d23faf373f9f2eaca",
      },
    ],
    siblingTree: { files: 91, sha256: "1".repeat(64) },
    extractedTree: { files: 91, sha256: "1".repeat(64) },
    payloadTreesEqual: true as const,
    extractedApplicationAudited: true as const,
    applicationPe: {
      productName: "BluedCode Dev",
      productVersion: "1.18.18-dev-0123456789",
      fileVersion: "1.18.18-dev-0123456789",
      numericFileVersion: "0.0.0.0",
      numericProductVersion: "0.0.0.0",
      signatureStatus: "NotSigned" as const,
      passed: true,
    },
    nativeExecutableSignatures: [
      {
        file: "resources/app.asar.unpacked/node_modules/@lydell/node-pty-win32-x64/prebuilds/win32-x64/conpty/OpenConsole.exe",
        signatureStatus: "Valid",
      },
    ],
    resourceEdit: {
      target: "win-unpacked/BluedCode Dev.exe",
      tool: resourceEditorTool,
      before: {
        productName: "BluedCode Dev",
        productVersion: "1.18.18.0",
        fileVersion: "1.18.18-dev-0123456789",
        numericFileVersion: "1.18.0.0",
        numericProductVersion: "1.18.18.0",
        signatureStatus: "NotSigned",
      },
      after: {
        productName: "BluedCode Dev",
        productVersion: "1.18.18-dev-0123456789",
        fileVersion: "1.18.18-dev-0123456789",
        numericFileVersion: "0.0.0.0",
        numericProductVersion: "0.0.0.0",
        signatureStatus: "NotSigned",
      },
      iconResources: {
        beforeSha256: "2".repeat(64),
        afterSha256: "2".repeat(64),
      },
      nonVersionResources: {
        beforeSha256: "3".repeat(64),
        afterSha256: "3".repeat(64),
      },
      passed: true as const,
    },
    passed: true as const,
  }
}

function devIdentity(): BuildIdentity {
  return {
    channel: "dev",
    name: "BluedCode Dev",
    appId: "ai.bluedcode.desktop.dev",
    protocol: "bluedcode-dev",
    version: "1.18.18-dev-0123456789",
    commit: "0123456789abcdef0123456789abcdef01234567",
    shortCommit: "0123456789",
    artifactName: "BluedCode-Dev-1.18.18-dev-0123456789-windows-x64-portable.exe",
  }
}

function builderConfigFixture(paths: ReturnType<typeof createBuildPaths>, repositoryRoot: string) {
  const assetsRoot = path.join(paths.stageDir, "assets", "fake")
  return createBuilderConfig({
    arch: "x64",
    afterSign: async () => {},
    assets: {
      iconIco: path.join(assetsRoot, "icon.ico"),
      faviconSvg: path.join(assetsRoot, "favicon.svg"),
      faviconPng: path.join(assetsRoot, "favicon.png"),
      wordmarkSvg: path.join(assetsRoot, "wordmark.svg"),
    },
    electronVersion: "42.3.3",
    identity: devIdentity(),
    nativePackageDir: path.join(repositoryRoot, "native"),
    paths,
    platform: "win32",
  })
}

async function writeFixture(file: string, content: string | Uint8Array) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content)
}

function resolveAsarCli() {
  const desktop = path.join(repositoryRoot(), "packages", "desktop")
  const electronBuilder = Bun.resolveSync("electron-builder", desktop)
  const appBuilder = Bun.resolveSync("app-builder-lib", electronBuilder)
  return Bun.resolveSync("@electron/asar/bin/asar.js", appBuilder)
}

function repositoryRoot() {
  return path.resolve(import.meta.dir, "../../../..")
}

async function temporaryRoot(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

async function expectFailure(promise: Promise<unknown>, pattern: RegExp) {
  const failure = await promise.then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(failure).toBeInstanceOf(Error)
  expect(String(failure)).toMatch(pattern)
}
