import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createBuildPaths } from "../common/paths"
import type { BuildIdentity } from "../common/types"
import {
  createBuilderConfig,
  createBrandedExecutableVersionHook,
  createReseditVersionOperations,
  deriveWindowsVersion,
  nativeRuntimeFiles,
  resourceEditorLock,
} from "../version/1.18.18/electron-builder"

const repositoryRoot = path.resolve(import.meta.dir, "../../../..")
const commit = "0123456789abcdef0123456789abcdef01234567"

describe("createBuilderConfig", () => {
  test("只声明 unsigned Windows x64 dir 且 publish 为空，由后续 zip 发布层压缩目录", () => {
    const context = builderContext(prodIdentity())
    const config = createBuilderConfig(context)

    expect(config.win?.target).toEqual([{ target: "dir", arch: ["x64"] }])
    expect(config.publish).toBeNull()
    expect(config.win).toMatchObject({
      forceCodeSigning: false,
      signExecutable: false,
      signExts: null,
      verifyUpdateCodeSignature: false,
    })
    expect(config.forceCodeSigning).toBe(false)
    expect(config.portable).toBeUndefined()
    expect(config.afterPack).toBeUndefined()
    expect(config.afterSign).toBe(context.afterSign)
    expect(JSON.stringify(config.win?.target)).not.toMatch(/portable|zip|nsis|msi/i)
    expect(JSON.stringify(config)).not.toMatch(/portable|nsis|msi|AppImage|dmg|signWindows|signtool|azureSign|sentry/i)
    expect(config).not.toHaveProperty("mac")
    expect(config).not.toHaveProperty("linux")
    expect(config).not.toHaveProperty("appx")
  })

  test("锁定 Builder 26.15.2 的 dir 目录载荷分支", async () => {
    const desktop = path.join(repositoryRoot, "packages", "desktop")
    const electronBuilderFile = Bun.resolveSync("electron-builder", desktop)
    const appBuilderFile = Bun.resolveSync("app-builder-lib", electronBuilderFile)
    const reseditFile = Bun.resolveSync("resedit", appBuilderFile)
    const versions = await Promise.all(
      [electronBuilderFile, appBuilderFile, reseditFile].map(async (moduleFile) => {
        const metadata: unknown = JSON.parse(
          await readFile(path.resolve(path.dirname(moduleFile), "..", "package.json"), "utf8"),
        )
        return metadata && typeof metadata === "object" && "version" in metadata ? metadata.version : undefined
      }),
    )

    expect(versions).toEqual(["26.15.2", "26.15.2", "1.7.2"])
    const reseditBytes = await readFile(reseditFile)
    expect(path.relative(path.resolve(path.dirname(reseditFile), ".."), reseditFile).replaceAll("\\", "/")).toBe(
      resourceEditorLock.entry,
    )
    expect({ size: reseditBytes.byteLength, sha256: createHash("sha256").update(reseditBytes).digest("hex") }).toEqual({
      size: resourceEditorLock.size,
      sha256: resourceEditorLock.sha256,
    })
    expect(createBuilderConfig(builderContext(devIdentity())).portable).toBeUndefined()
  })

  test("锁定 Builder 26.15.2 在资源编辑后、dir 目录输出完成前触发 afterSign", async () => {
    const desktop = path.join(repositoryRoot, "packages", "desktop")
    const electronBuilderFile = Bun.resolveSync("electron-builder", desktop)
    const appBuilderFile = Bun.resolveSync("app-builder-lib", electronBuilderFile)
    const appBuilderRoot = path.resolve(path.dirname(appBuilderFile), "..")
    const [platformPackager, winPackager] = await Promise.all([
      readFile(path.join(appBuilderRoot, "out", "platformPackager.js"), "utf8"),
      readFile(path.join(appBuilderRoot, "out", "winPackager.js"), "utf8"),
    ])

    expect(platformPackager).toContain("await this.info.emitAfterPack(packContext);")
    expect(platformPackager).toContain("await this.doSignAfterPack(outDir, appOutDir")
    expect(platformPackager).toContain("const didSign = await this.signApp(packContext, isAsar);")
    expect(platformPackager).toContain("await this.info.emitAfterSign(packContext);")
    expect(platformPackager.indexOf("await this.info.emitAfterPack(packContext);")).toBeLessThan(
      platformPackager.indexOf("await this.doSignAfterPack(outDir, appOutDir"),
    )
    expect(platformPackager.indexOf("const didSign = await this.signApp(packContext, isAsar);")).toBeLessThan(
      platformPackager.indexOf("await this.info.emitAfterSign(packContext);"),
    )
    expect(platformPackager.indexOf("await this.doPack({")).toBeLessThan(
      platformPackager.indexOf("this.packageInDistributableFormat(appOutDir"),
    )
    expect(winPackager).toContain("await this.signAndEditResources(path.join(packContext.appOutDir, exeFileName)")
    expect(winPackager).toContain("return true;")
  })

  test("files 只接受 Task 6 out、Task 5 派生资源和原生精确白名单", () => {
    const context = builderContext(devIdentity())
    const config = createBuilderConfig(context)

    expect(config.files).toEqual([
      "package.json",
      "!**/node_modules/**/*",
      ...nativeRuntimeFiles.map((file) => `node_modules/@lydell/node-pty-win32-x64/${file}`),
      {
        from: path.join(context.paths.stageDir, "desktop", "out"),
        to: "out",
        filter: ["main/**/*", "preload/**/*", "renderer/**/*"],
      },
      {
        from: path.dirname(context.assets.iconIco),
        to: "assets",
        filter: ["favicon.png", "favicon.svg", "icon.ico", "wordmark.svg"],
      },
    ])
    expect(config.asarUnpack).toEqual(
      nativeRuntimeFiles
        .filter((file) => /\.(?:dll|exe|node)$/.test(file))
        .map((file) => `node_modules/@lydell/node-pty-win32-x64/${file}`),
    )
    expect(JSON.stringify(config.files)).not.toContain(path.join("packages", "desktop", "out"))
    expect(JSON.stringify(config.files)).not.toContain(path.join("packages", "desktop", "resources"))
  })

  test("extraMetadata 保留完整组合版本并让 physical package 位于隔离 stage", () => {
    const context = builderContext(prodIdentity())
    const config = createBuilderConfig(context)

    expect(config.directories).toEqual({
      app: path.join(context.paths.stageDir, "package"),
      buildResources: path.dirname(context.assets.iconIco),
      output: context.paths.outDir,
    })
    expect(config.extraMetadata).toEqual({
      author: { name: "ForeachCode" },
      description: "BluedCode Windows Desktop",
      main: "out/main/index.js",
      name: "bluedcode-desktop",
      productName: "BluedCode",
      type: "module",
      version: "1.18.18-260815-01-0123456789",
    })
    expect(config.artifactName).toBe("BluedCode-1.18.18-260815-01-0123456789-windows-x64.zip")
    expect(config.protocols).toEqual({ name: "BluedCode", schemes: ["bluedcode"] })
  })

  test("拒绝 beta、非 Windows x64 和不完整资源集合", () => {
    const context = builderContext(devIdentity())
    expect(() => createBuilderConfig({ ...context, platform: "linux" })).toThrow("Windows")
    expect(() => createBuilderConfig({ ...context, arch: "arm64" })).toThrow("x64")
    expect(() =>
      Reflect.apply(createBuilderConfig, undefined, [
        { ...context, identity: { ...context.identity, channel: "beta" } },
      ]),
    ).toThrow("dev 或 prod")
    expect(() => createBuilderConfig({ ...context, assets: { ...context.assets, iconIco: "../icon.ico" } })).toThrow(
      "Task 5",
    )
  })
})

describe("afterSign 品牌应用 PE 版本资源兼容处理", () => {
  test("修改前后精确认证并记录完整版本、数字版本和资源摘要", async () => {
    const fixture = await afterSignFixture("success")
    try {
      const before = builderPeBefore(fixture.identity)
      const after = brandedPeAfter(fixture.identity)
      const edits: unknown[] = []
      const controller = createBrandedExecutableVersionHook({
        identity: fixture.identity,
        paths: fixture.paths,
        operations: operations([before, after], edits),
      })

      await controller.afterSign(afterSignContext(fixture))

      expect(edits).toEqual([
        {
          executable: fixture.executable,
          fullVersion: fixture.identity.version,
          numericVersion: "0.0.0.0",
        },
      ])
      expect(controller.requireAudit()).toEqual({
        target: "win-unpacked/BluedCode Dev.exe",
        tool: resourceEditorLock,
        before,
        after,
        iconResources: { beforeSha256: "1".repeat(64), afterSha256: "1".repeat(64) },
        nonVersionResources: { beforeSha256: "2".repeat(64), afterSha256: "2".repeat(64) },
        passed: true,
      })
      expect(() => controller.requireAudit()).not.toThrow()
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  test("拒绝错误 platform、arch、target 与 canonical output", async () => {
    const fixture = await afterSignFixture("context")
    try {
      for (const override of [
        { electronPlatformName: "linux" },
        { arch: 3 },
        { targets: [{ name: "portable" }] },
        { outDir: path.join(fixture.root, "escaped-out") },
        { appOutDir: path.join(fixture.root, "escaped-app") },
      ]) {
        const controller = createBrandedExecutableVersionHook({
          identity: fixture.identity,
          paths: fixture.paths,
          operations: operations([builderPeBefore(fixture.identity), brandedPeAfter(fixture.identity)]),
        })
        await expectFailure(
          controller.afterSign({ ...afterSignContext(fixture), ...override }),
          /afterSign|Windows|x64|dir|路径|output/i,
        )
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  test("拒绝品牌 EXE 为零个、多个或错误文件名", async () => {
    for (const names of [[], ["BluedCode Dev.exe", "extra.exe"], ["renamed.exe"]]) {
      const fixture = await afterSignFixture(`exe-${names.length}`, names)
      try {
        const controller = createBrandedExecutableVersionHook({
          identity: fixture.identity,
          paths: fixture.paths,
          operations: operations([builderPeBefore(fixture.identity), brandedPeAfter(fixture.identity)]),
        })
        await expectFailure(controller.afterSign(afterSignContext(fixture)), /唯一|EXE|文件名/i)
      } finally {
        await rm(fixture.root, { recursive: true, force: true })
      }
    }
  })

  test("拒绝品牌 EXE 或 appOutDir junction，不接触外部文件", async () => {
    const fixture = await afterSignFixture("junction")
    const external = await mkdtemp(path.join(os.tmpdir(), "bluedcode-after-pack-external-"))
    try {
      const sentinel = path.join(external, "sentinel.txt")
      await writeFile(sentinel, "keep")
      await rm(fixture.appOutDir, { recursive: true })
      await symlink(external, fixture.appOutDir, "junction")
      const controller = createBrandedExecutableVersionHook({
        identity: fixture.identity,
        paths: fixture.paths,
        operations: operations([builderPeBefore(fixture.identity), brandedPeAfter(fixture.identity)]),
      })

      await expectFailure(controller.afterSign(afterSignContext(fixture)), /链接|junction|canonical|路径/i)
      expect(await readFile(sentinel, "utf8")).toBe("keep")
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
      await rm(external, { recursive: true, force: true })
    }
  })

  test("修改前元数据不符合锁定 Builder 26.15.2 行为时拒绝编辑", async () => {
    const fixture = await afterSignFixture("before")
    const edits: unknown[] = []
    try {
      const controller = createBrandedExecutableVersionHook({
        identity: fixture.identity,
        paths: fixture.paths,
        operations: operations(
          [{ ...builderPeBefore(fixture.identity), productVersion: fixture.identity.version }],
          edits,
        ),
      })

      await expectFailure(controller.afterSign(afterSignContext(fixture)), /修改前|26\.15\.2|ProductVersion/i)
      expect(edits).toEqual([])
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  test("修改后完整版本、数字版本、名称、unsigned 或 icon 任一变化都 fail closed", async () => {
    const fixture = await afterSignFixture("after")
    try {
      const invalidCases = [
        { after: { ...brandedPeAfter(fixture.identity), productVersion: "1.18.18.0" }, icon: "1".repeat(64) },
        { after: { ...brandedPeAfter(fixture.identity), numericFileVersion: "1.18.18.0" }, icon: "1".repeat(64) },
        { after: { ...brandedPeAfter(fixture.identity), productName: "Other" }, icon: "1".repeat(64) },
        { after: { ...brandedPeAfter(fixture.identity), signatureStatus: "UnknownError" }, icon: "1".repeat(64) },
        { after: brandedPeAfter(fixture.identity), icon: "3".repeat(64) },
      ]
      for (const invalid of invalidCases) {
        const controller = createBrandedExecutableVersionHook({
          identity: fixture.identity,
          paths: fixture.paths,
          operations: operations([builderPeBefore(fixture.identity), invalid.after], [], invalid.icon),
        })
        await expectFailure(
          controller.afterSign(afterSignContext(fixture)),
          /修改后|版本|ProductName|unsigned|资源|icon/i,
        )
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })
})

describe("resedit 实际执行供应链", () => {
  test("wrapper 不变时 index、resource 或 pe-library 任一实现篡改都在资源编辑前拒绝", async () => {
    for (const relative of [
      "resedit/dist/index.js",
      "resedit/dist/resource/VersionInfo.js",
      "pe-library/dist/NtExecutable.js",
    ]) {
      const fixture = await resourceEditorFixture(relative.replaceAll("/", "-"))
      try {
        const wrapperBefore = createHash("sha256")
          .update(await readFile(fixture.moduleFile))
          .digest("hex")
        const target = relative.startsWith("resedit/")
          ? path.join(fixture.reseditRoot, ...relative.slice("resedit/".length).split("/"))
          : path.join(fixture.peLibraryRoot, ...relative.slice("pe-library/".length).split("/"))
        const tampered = Buffer.from(await readFile(target))
        tampered[tampered.length - 1] ^= 1
        await writeFile(target, tampered)
        expect(
          createHash("sha256")
            .update(await readFile(fixture.moduleFile))
            .digest("hex"),
        ).toBe(wrapperBefore)

        const operations = createReseditVersionOperations({
          moduleFile: fixture.moduleFile,
          readPeMetadata: async () => brandedPeAfter(devIdentity()),
          repositoryRoot: fixture.root,
        })
        await expectFailure(
          operations.editVersionResource({
            executable: path.join(fixture.root, "must-not-read.exe"),
            fullVersion: devIdentity().version,
            numericVersion: "0.0.0.0",
          }),
          /资源编辑器供应链 (?:resedit|pe-library) 文件 .* SHA-256 不匹配/,
        )
      } finally {
        await rm(fixture.root, { recursive: true, force: true })
      }
    }
  })

  test("完整 36+19 文件图和真实 require 解析通过后才读取目标 EXE", async () => {
    const fixture = await resourceEditorFixture("valid")
    try {
      const operations = createReseditVersionOperations({
        moduleFile: fixture.moduleFile,
        readPeMetadata: async () => brandedPeAfter(devIdentity()),
        repositoryRoot: fixture.root,
      })
      await expectFailure(
        operations.editVersionResource({
          executable: path.join(fixture.root, "must-not-read.exe"),
          fullVersion: devIdentity().version,
          numericVersion: "0.0.0.0",
        }),
        /ENOENT.*must-not-read\.exe/,
      )
      expect(resourceEditorLock.packages.map((lockedPackage) => lockedPackage.files.length)).toEqual([36, 19])
      expect(resourceEditorLock.graphSha256).toMatch(/^[a-f0-9]{64}$/)
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  test("pe-library 只允许锁定位置与目标的唯一 junction", async () => {
    for (const mode of ["concrete", "wrong-target"] as const) {
      const fixture = await resourceEditorFixture(mode)
      try {
        await rm(fixture.dependencyLink, { recursive: true, force: true })
        if (mode === "concrete") {
          await cp(fixture.peLibraryRoot, fixture.dependencyLink, { recursive: true })
        } else {
          const alternative = path.join(fixture.root, "alternative-pe-library")
          await cp(fixture.peLibraryRoot, alternative, { recursive: true })
          await symlink(alternative, fixture.dependencyLink, "junction")
        }
        const operations = createReseditVersionOperations({
          moduleFile: fixture.moduleFile,
          readPeMetadata: async () => brandedPeAfter(devIdentity()),
          repositoryRoot: fixture.root,
        })
        await expectFailure(
          operations.editVersionResource({
            executable: path.join(fixture.root, "must-not-read.exe"),
            fullVersion: devIdentity().version,
            numericVersion: "0.0.0.0",
          }),
          mode === "concrete" ? /必须是唯一锁定 junction/ : /junction 目标不匹配/,
        )
      } finally {
        await rm(fixture.root, { recursive: true, force: true })
      }
    }
  })

  test("实现图任一嵌套目录 junction 都不能伪装成同哈希锁定文件", async () => {
    const fixture = await resourceEditorFixture("nested-junction")
    try {
      const resourceDirectory = path.join(fixture.reseditRoot, "dist", "resource")
      const alternative = path.join(fixture.root, "alternative-resource")
      await cp(resourceDirectory, alternative, { recursive: true })
      await rm(resourceDirectory, { recursive: true })
      await symlink(alternative, resourceDirectory, "junction")
      const operations = createReseditVersionOperations({
        moduleFile: fixture.moduleFile,
        readPeMetadata: async () => brandedPeAfter(devIdentity()),
        repositoryRoot: fixture.root,
      })
      await expectFailure(
        operations.editVersionResource({
          executable: path.join(fixture.root, "must-not-read.exe"),
          fullVersion: devIdentity().version,
          numericVersion: "0.0.0.0",
        }),
        /具体目录|junction|reparse|canonical/i,
      )
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })
})

function builderContext(identity: BuildIdentity) {
  const paths = createBuildPaths(identity, repositoryRoot)
  const assetRoot = path.join(paths.stageDir, "assets", "fixture")
  return {
    arch: "x64" as const,
    assets: {
      iconIco: path.join(assetRoot, "icon.ico"),
      faviconPng: path.join(assetRoot, "favicon.png"),
      faviconSvg: path.join(assetRoot, "favicon.svg"),
      wordmarkSvg: path.join(assetRoot, "wordmark.svg"),
    },
    afterSign: async () => {},
    electronVersion: "42.3.3",
    identity,
    nativePackageDir: path.join(repositoryRoot, "packages", "desktop", "node_modules", "@lydell", "node-pty-win32-x64"),
    paths,
    platform: "win32" as const,
  }
}

async function afterSignFixture(label: string, executableNames = ["BluedCode Dev.exe"]) {
  const root = await mkdtemp(path.join(os.tmpdir(), `bluedcode-after-sign-${label}-`))
  const identity = devIdentity()
  const paths = createBuildPaths(identity, root)
  const appOutDir = path.join(paths.outDir, "win-unpacked")
  await mkdir(appOutDir, { recursive: true })
  await Promise.all(executableNames.map((name) => writeFile(path.join(appOutDir, name), "fixture")))
  return { root, identity, paths, appOutDir, executable: path.join(appOutDir, `${identity.name}.exe`) }
}

async function resourceEditorFixture(label: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), `bluedcode-resedit-graph-${label}-`))
  const desktop = path.join(repositoryRoot, "packages", "desktop")
  const electronBuilderFile = Bun.resolveSync("electron-builder", desktop)
  const appBuilderFile = Bun.resolveSync("app-builder-lib", electronBuilderFile)
  const installedModule = Bun.resolveSync("resedit", appBuilderFile)
  const installedReseditRoot = path.resolve(path.dirname(installedModule), "..")
  const installedPeEntry = Bun.resolveSync("pe-library", installedModule)
  const installedPeRoot = path.resolve(path.dirname(installedPeEntry), "..")
  const bunRoot = path.join(root, "node_modules", ".bun")
  const reseditNodeModules = path.join(bunRoot, "resedit@1.7.2", "node_modules")
  const peLibraryNodeModules = path.join(bunRoot, "pe-library@0.4.1", "node_modules")
  const reseditRoot = path.join(reseditNodeModules, "resedit")
  const peLibraryRoot = path.join(peLibraryNodeModules, "pe-library")
  await Promise.all([
    cp(installedReseditRoot, reseditRoot, { recursive: true }),
    cp(installedPeRoot, peLibraryRoot, { recursive: true }),
  ])
  const dependencyLink = path.join(reseditNodeModules, "pe-library")
  await symlink(peLibraryRoot, dependencyLink, "junction")
  return {
    root,
    reseditRoot,
    peLibraryRoot,
    dependencyLink,
    moduleFile: path.join(reseditRoot, "dist", "index.mjs"),
  }
}

function afterSignContext(fixture: Awaited<ReturnType<typeof afterSignFixture>>) {
  return {
    outDir: fixture.paths.outDir,
    appOutDir: fixture.appOutDir,
    arch: 1,
    electronPlatformName: "win32",
    targets: [{ name: "dir" }],
    packager: {
      platform: { name: "windows", nodeName: "win32", buildConfigurationKey: "win" },
      appInfo: { productName: fixture.identity.name, version: fixture.identity.version },
      config: { appId: fixture.identity.appId },
    },
  }
}

function builderPeBefore(identity: BuildIdentity) {
  return {
    productName: identity.name,
    productVersion: "1.18.18.0",
    fileVersion: identity.version,
    numericFileVersion: "1.18.0.0",
    numericProductVersion: "1.18.18.0",
    signatureStatus: "NotSigned",
  }
}

function brandedPeAfter(identity: BuildIdentity) {
  return {
    productName: identity.name,
    productVersion: identity.version,
    fileVersion: identity.version,
    numericFileVersion: "0.0.0.0",
    numericProductVersion: "0.0.0.0",
    signatureStatus: "NotSigned",
  }
}

function operations(metadata: unknown[], edits: unknown[] = [], iconAfter = "1".repeat(64)) {
  let read = 0
  return {
    async readPeMetadata() {
      return metadata[Math.min(read++, metadata.length - 1)]
    },
    async editVersionResource(input: unknown) {
      edits.push(input)
      return {
        tool: resourceEditorLock,
        iconResources: { beforeSha256: "1".repeat(64), afterSha256: iconAfter },
        nonVersionResources: { beforeSha256: "2".repeat(64), afterSha256: "2".repeat(64) },
      }
    },
  }
}

function devIdentity(): BuildIdentity {
  return {
    channel: "dev",
    name: "BluedCode Dev",
    appId: "ai.bluedcode.desktop.dev",
    protocol: "bluedcode-dev",
    version: "1.18.18-dev-0123456789",
    commit,
    shortCommit: "0123456789",
    artifactName: "BluedCode-Dev-1.18.18-dev-0123456789-windows-x64.zip",
    artifactDirectoryName: "BluedCode-Dev-1.18.18-dev-0123456789",
  }
}

function prodIdentity(): BuildIdentity {
  return {
    channel: "prod",
    name: "BluedCode",
    appId: "ai.bluedcode.desktop",
    protocol: "bluedcode",
    version: "1.18.18-260815-01-0123456789",
    commit,
    shortCommit: "0123456789",
    artifactName: "BluedCode-1.18.18-260815-01-0123456789-windows-x64.zip",
    artifactDirectoryName: "BluedCode-1.18.18-260815-01-0123456789",
    tag: "bluedcode-v1.18.18-260815-01",
  }
}

async function expectFailure(promise: Promise<unknown>, pattern: RegExp) {
  const failure = await promise.then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(failure).toBeInstanceOf(Error)
  expect(String(failure)).toMatch(pattern)
}
