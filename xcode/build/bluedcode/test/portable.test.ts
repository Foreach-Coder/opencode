import { afterAll, expect, test } from "bun:test"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import * as portableModule from "../common/portable"
import { auditFinalPortablePayload, nsisControlPayload, portableExtractorLock } from "../common/portable"

const ownedRoots: string[] = []

afterAll(async () => {
  await Promise.all(ownedRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

test("锁定官方 7-Zip 26.02 只读 NSIS 提取供应链与精确控制载荷", () => {
  expect(portableExtractorLock).toEqual({
    version: "26.02",
    runner: {
      file: "7zr.exe",
      url: "https://github.com/ip7z/7zip/releases/download/26.02/7zr.exe",
      size: 602112,
      sha256: "56b8cc9f4971cef253644fafe54063ed7fdca551d4dee0f8c6baa81b855acd72",
    },
    installer: {
      file: "7z2602-x64.exe",
      url: "https://github.com/ip7z/7zip/releases/download/26.02/7z2602-x64.exe",
      size: 1657896,
      sha256: "6745fa76dc2ea031596d8678f6f6b99c3c1b435b4164a63485adbbc7b8d82ef0",
    },
    executable: {
      file: "7z.exe",
      size: 576000,
      sha256: "83967f1b02b43c4efeda302795722c809e0e81b8307de73558d10484d5676a7d",
    },
    library: {
      file: "7z.dll",
      size: 1906688,
      sha256: "69fd4df057985c40e510e2fac182881c7f85e90aa13ec703f763a8fdb2ce61f8",
    },
  })
  expect(nsisControlPayload).toEqual([
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
  ])
})

test("最终 Portable 从 EXE 只读提取并与 win-unpacked 逐项一致，内嵌篡改不会被同胞审计漏过", async () => {
  if (process.platform !== "win32") return
  const paths = await ownedFixturePaths()
  const siblingRoot = path.join(paths.workspaceRoot, "win-unpacked")
  const matchingSource = path.join(paths.workspaceRoot, "matching-source")
  const tamperedSource = path.join(paths.workspaceRoot, "tampered-source")
  const matchingPortable = path.join(paths.workspaceRoot, "matching.exe")
  const tamperedPortable = path.join(paths.workspaceRoot, "tampered.exe")
  await Promise.all([
    writeFixture(path.join(siblingRoot, "BluedCode Dev.exe"), "trusted-app"),
    writeFixture(path.join(siblingRoot, "resources", "app.asar"), "trusted-asar"),
    writeFixture(path.join(matchingSource, "BluedCode Dev.exe"), "trusted-app"),
    writeFixture(path.join(matchingSource, "resources", "app.asar"), "trusted-asar"),
    writeFixture(path.join(tamperedSource, "BluedCode Dev.exe"), "trusted-app"),
    writeFixture(path.join(tamperedSource, "resources", "app.asar"), "tampered-asar"),
  ])
  await Promise.all([
    createNsisFixture(matchingSource, matchingPortable),
    createNsisFixture(tamperedSource, tamperedPortable),
  ])

  const matching = await auditFinalPortablePayload({
    executable: matchingPortable,
    paths,
    siblingRoot,
    auditApplication: async (root) => readFile(path.join(root, "resources", "app.asar"), "utf8"),
  })
  expect(matching.application).toBe("trusted-asar")
  expect(matching.portable.payloadTreesEqual).toBe(true)
  expect(matching.portable.archive).toEqual({ method: "Deflate", subtype: "NSIS-3 Unicode", type: "Nsis" })
  expect(matching.portable.controlPayload).toEqual(nsisControlPayload)

  await expectFailure(
    auditFinalPortablePayload({
      executable: tamperedPortable,
      paths,
      siblingRoot,
      auditApplication: async () => "must-not-run",
    }),
    /最终 Portable.*win-unpacked|载荷树|摘要/i,
  )
}, 60_000)

test("真实 NSIS 在 Windows 大小写等价 entry 折叠成 sibling 后仍必须拒绝", async () => {
  if (process.platform !== "win32") return
  const paths = await ownedFixturePaths()
  const siblingRoot = path.join(paths.workspaceRoot, "win-unpacked")
  const sourceRoot = path.join(paths.workspaceRoot, "alias-source")
  const portable = path.join(paths.workspaceRoot, "case-alias.exe")
  const upper = path.join(sourceRoot, "upper.txt")
  const lower = path.join(sourceRoot, "lower.txt")
  await Promise.all([
    writeFixture(path.join(siblingRoot, "payload.txt"), "trusted-lower"),
    writeFixture(upper, "untrusted-upper"),
    writeFixture(lower, "trusted-lower"),
  ])
  await createMappedNsisFixture(
    [
      { file: "Payload.txt", source: upper },
      { file: "payload.txt", source: lower },
    ],
    portable,
  )

  await expectFailure(
    auditFinalPortablePayload({
      executable: portable,
      paths,
      siblingRoot,
      auditApplication: async () => "must-not-run",
    }),
    /Windows|等价|重复|大小写|listing|清单/i,
  )
}, 60_000)

test("Windows archive path 合同拒绝大小写、尾点空格、ADS、设备名与控制字符别名", () => {
  for (const paths of [
    ["Payload.txt", "payload.txt"],
    ["payload."],
    ["payload "],
    ["nested./payload.txt"],
    ["nested /payload.txt"],
    ["payload.txt:stream"],
    ["CON"],
    ["con.txt"],
    ["LPT1.log"],
    ["COM¹.txt"],
    ["control\u0001.txt"],
  ]) {
    expect(() => callWindowsArchivePathValidator(paths)).toThrow(/Windows|路径|等价|设备|ADS|规范|重复/i)
  }
})

test("Windows archive path 合同拒绝绝对、drive、UNC、空段与 traversal", () => {
  for (const paths of [
    ["/absolute.txt"],
    ["C:\\absolute.txt"],
    ["\\\\server\\share.txt"],
    ["nested//payload.txt"],
    ["nested/../payload.txt"],
  ]) {
    expect(() => callWindowsArchivePathValidator(paths)).toThrow(/Windows|路径|绝对|UNC|drive|规范|越界/i)
  }
})

test("Windows archive listing 与提取树必须按数量、规范路径和 canonical key 一一对应", () => {
  expect(() => callWindowsArchivePathValidator(["payload.txt"], [])).toThrow(/listing|提取|数量|一一对应/i)
  expect(() => callWindowsArchivePathValidator(["Payload.txt"], ["payload.txt"])).toThrow(/listing|提取|路径|一一对应/i)
})

test("Windows archive path 合同保留合法 Unicode 且统一 listing 分隔符", () => {
  expect(
    callWindowsArchivePathValidator(
      ["$PLUGINSDIR\\System.dll", "资源/éxample.txt"],
      ["$PLUGINSDIR/System.dll", "资源/éxample.txt"],
    ),
  ).toEqual([
    { file: "$PLUGINSDIR/System.dll", windowsKey: "$pluginsdir/system.dll" },
    { file: "资源/éxample.txt", windowsKey: "资源/éxample.txt" },
  ])
})

async function createNsisFixture(source: string, executable: string) {
  return compileNsisFixture(executable, [`File /r "${nsisPath(path.join(source, "*.*"))}"`])
}

async function createMappedNsisFixture(entries: Array<{ file: string; source: string }>, executable: string) {
  return compileNsisFixture(
    executable,
    entries.map((entry) => `File ${nsisOnName(entry.file)} "${nsisPath(entry.source)}"`),
  )
}

async function compileNsisFixture(executable: string, fileCommands: string[]) {
  const desktop = path.join(repositoryRoot(), "packages", "desktop")
  const electronBuilder = Bun.resolveSync("electron-builder", desktop)
  const appBuilder = Bun.resolveSync("app-builder-lib", electronBuilder)
  const moduleFile = path.join(path.dirname(appBuilder), "toolsets", "windows.js")
  const loaded: unknown = await import(pathToFileURL(moduleFile).href)
  if (
    !loaded ||
    typeof loaded !== "object" ||
    !("getMakeNsisPath" in loaded) ||
    typeof loaded.getMakeNsisPath !== "function" ||
    !("getNsisPluginsPath" in loaded) ||
    typeof loaded.getNsisPluginsPath !== "function"
  ) {
    throw new Error("锁定 app-builder-lib NSIS toolset API 无效")
  }
  const makeNsis: unknown = await Reflect.apply(loaded.getMakeNsisPath, undefined, [undefined, undefined])
  const plugins: unknown = await Reflect.apply(loaded.getNsisPluginsPath, undefined, [undefined, undefined])
  if (
    !makeNsis ||
    typeof makeNsis !== "object" ||
    !("path" in makeNsis) ||
    typeof makeNsis.path !== "string" ||
    ("env" in makeNsis && makeNsis.env !== undefined && (typeof makeNsis.env !== "object" || !makeNsis.env)) ||
    typeof plugins !== "string"
  ) {
    throw new Error("锁定 app-builder-lib NSIS toolset 返回值无效")
  }
  const script = path.join(path.dirname(executable), `${path.basename(executable)}.nsi`)
  await writeFile(
    script,
    [
      "Unicode true",
      "SetCompressor zlib",
      `!addplugindir /x86-unicode "${nsisPath(path.join(plugins, "x86-unicode"))}"`,
      `OutFile "${nsisPath(executable)}"`,
      "SilentInstall silent",
      "Section",
      'SetOutPath "$INSTDIR"',
      ...fileCommands,
      "System::Call 'kernel32::GetCurrentProcessId() i .r0'",
      'Push ""',
      'Push ""',
      "StdUtils::GetParameter /NOUNLOAD",
      "Pop $0",
      "SectionEnd",
      "",
    ].join("\n"),
  )
  const child = Bun.spawn([makeNsis.path, "/V2", script], {
    env: { ...process.env, ...("env" in makeNsis && makeNsis.env) },
    stderr: "pipe",
    stdout: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`NSIS fixture 编译失败 (${exitCode}): ${stdout}\n${stderr}`)
}

async function ownedFixturePaths() {
  const repository = repositoryRoot()
  const outputRoot = path.join(repository, ".xcode", "bluedcode")
  const workspaceRoot = path.join(outputRoot, "task-7-tests", crypto.randomUUID())
  await mkdir(workspaceRoot, { recursive: true })
  ownedRoots.push(workspaceRoot)
  return { outputRoot, repositoryRoot: repository, workspaceRoot }
}

function nsisPath(value: string) {
  return value.replaceAll("/", "\\")
}

function nsisOnName(value: string) {
  if (/[\r\n"$]/.test(value)) throw new Error(`NSIS fixture entry 无效: ${value}`)
  return `"/oname=${value}"`
}

function repositoryRoot() {
  return path.resolve(import.meta.dir, "../../../..")
}

async function writeFixture(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content)
}

async function expectFailure(promise: Promise<unknown>, pattern: RegExp) {
  const failure = await promise.then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(failure).toBeInstanceOf(Error)
  expect(String(failure)).toMatch(pattern)
}

function callWindowsArchivePathValidator(listing: string[], extracted?: string[]) {
  const validate: unknown = Reflect.get(portableModule, "validateWindowsArchivePaths")
  if (typeof validate !== "function") throw new Error("archive validator missing")
  return Reflect.apply(validate, undefined, extracted ? [listing, extracted] : [listing])
}
