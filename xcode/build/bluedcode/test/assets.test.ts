import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  deriveDesktopAssets,
  resizeRgba,
  validateBrandAssets,
  validatePng,
  validateSvg,
  visualDigest,
} from "../common/assets"
import { createBuildPaths } from "../common/paths"
import type { BuildIdentity } from "../common/types"

const snapshotRoot = path.resolve(import.meta.dir, "..")
const roots: string[] = []
const icoSizes = [16, 24, 32, 48, 64, 128, 256]

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test("expectRejected 在 promise 成功且未指定消息时仍然失败", async () => {
  let observed: unknown
  try {
    await expectRejected(Promise.resolve())
  } catch (error) {
    observed = error
  }

  if (!(observed instanceof Error)) throw new Error("外层未观察到 expectRejected 失败")
  expect(observed.message).toBe("预期 Promise 失败，实际成功")
})

test("校验规范品牌资源并生成不含路径的视觉摘要", async () => {
  const first = await validateBrandAssets(snapshotRoot)
  const secondRoot = await temporarySnapshot("same-bytes")
  const second = await validateBrandAssets(secondRoot)

  expect(first).toEqual(second)
  expect(first.digest).toMatch(/^[a-f0-9]{64}$/)
  expect(first.files).toEqual({
    "app-icon.png": expect.stringMatching(/^[a-f0-9]{64}$/),
    "app-icon.svg": expect.stringMatching(/^[a-f0-9]{64}$/),
    "brand.json": expect.stringMatching(/^[a-f0-9]{64}$/),
    "wordmark.png": expect.stringMatching(/^[a-f0-9]{64}$/),
    "wordmark.svg": expect.stringMatching(/^[a-f0-9]{64}$/),
  })
})

test("SVG 校验大小写不敏感地拒绝可执行内容、嵌入对象和非白名单引用", async () => {
  const malicious = [
    '<svg xmlns="http://www.w3.org/2000/svg"><ScRiPt>alert(1)</ScRiPt></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" OnLoAd="alert(1)"></svg>',
    '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"/>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><OBJECT/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><embed/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="//example.com/x.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AAAA"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="../app-icon.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href=".\\app-icon.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="#app-icon"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path style="fill:url(https://example.com/x.svg)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image XLINK:HREF="./app-icon.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "https://example.com/x.css";</style></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><style>.x{fill:u/**/rl(data:image/png;base64,AAAA)}</style></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><style>@im&#112;ort "https://example.com/x.css";</style></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"></svg><svg></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><svg></svg></svg>',
  ]

  for (const svg of malicious) await expectRejected(validateSvg(svg, ["./app-icon.png"]))
  expect(
    await validateSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><image width="1" height="1" href="./app-icon.png"/></svg>',
      ["./app-icon.png"],
    ),
  ).toEqual({ hrefs: ["./app-icon.png"] })
})

test("品牌 icon SVG 必须有正方形正 viewBox 和精确 title", async () => {
  const root = await temporarySnapshot("svg-contract")
  const invalid = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 11">' +
      '<title>BluedCode application icon</title><image href="./app-icon.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0">' +
      '<title>BluedCode application icon</title><image href="./app-icon.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<title>BluedCode</title><image href="./app-icon.png"/></svg>',
  ]

  for (const svg of invalid) {
    await writeFile(path.join(root, "app-icon.svg"), svg)
    await updateManifest(root)
    await expectRejected(validateBrandAssets(root))
  }
})

test("品牌 icon SVG 必须恰好包含一个规范 app-icon.png href", async () => {
  const root = await temporarySnapshot("svg-href-count")
  const invalid = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254">' +
      "<title>BluedCode application icon</title></svg>",
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254">' +
      '<title>BluedCode application icon</title><image href="./app-icon.png"/>' +
      '<image href="./app-icon.png"/></svg>',
  ]

  for (const svg of invalid) {
    await writeFile(path.join(root, "app-icon.svg"), svg)
    await updateManifest(root)
    await expectRejected(validateBrandAssets(root), "恰好一个")
  }
})

test("PNG 校验完整 chunk CRC、边界和唯一 IEND，并只接受 8-bit RGBA 方形输入", async () => {
  const valid = new Uint8Array(await Bun.file(path.join(snapshotRoot, "app-icon.png")).arrayBuffer())
  expect(await validatePng(valid)).toEqual({ width: 1254, height: 1254 })

  const badCrc = valid.slice()
  badCrc[100] ^= 0xff
  await expectRejected(validatePng(badCrc), "CRC")
  await expectRejected(validatePng(valid.subarray(0, valid.length - 1)))
  await expectRejected(validatePng(new Uint8Array([...valid, 0])))

  for (const [offset, value] of [
    [24, 16],
    [25, 2],
    [26, 1],
    [27, 1],
    [28, 1],
  ] as const) {
    const unsupported = valid.slice()
    unsupported[offset] = value
    rewriteChunkCrc(unsupported, 8)
    await expectRejected(validatePng(unsupported), "8-bit RGBA")
  }

  const rectangular = valid.slice()
  new DataView(rectangular.buffer).setUint32(20, 1253)
  rewriteChunkCrc(rectangular, 8)
  await expectRejected(validatePng(rectangular), "正方形")
})

test("PNG 在 inflate 和像素分配前执行输入、维度、像素、行与 IDAT 预算", async () => {
  const valid = new Uint8Array(await Bun.file(path.join(snapshotRoot, "app-icon.png")).arrayBuffer())
  const oversizedInput = new Uint8Array(20_000_001)
  oversizedInput.set([137, 80, 78, 71, 13, 10, 26, 10])
  await expectRejected(validatePng(oversizedInput), "资源预算")

  for (const size of [4097, 0xffffffff]) {
    const oversizedDimension = valid.slice()
    const view = new DataView(oversizedDimension.buffer)
    view.setUint32(16, size)
    view.setUint32(20, size)
    rewriteChunkCrc(oversizedDimension, 8)
    await expectRejected(validatePng(oversizedDimension), "资源预算")
  }

  const oversizedRows = valid.slice()
  const rowsView = new DataView(oversizedRows.buffer)
  rowsView.setUint32(16, 4096)
  rowsView.setUint32(20, 4096)
  rewriteChunkCrc(oversizedRows, 8)
  await expectRejected(validatePng(oversizedRows), "资源预算")

  await expectRejected(validatePng(pngFixture(1, 1, 16_777_217)), "IDAT 资源预算")
})

test("视觉摘要排除 tui.json，但快照验证仍包含 tui.json", async () => {
  const changed = await temporarySnapshot("tui-excluded")
  await writeFile(path.join(changed, "tui.json"), '{"changed":true}')
  await updateManifest(changed)

  expect(await visualDigest(changed)).toBe(await visualDigest(snapshotRoot))
  await writeFile(path.join(changed, "tui.json"), '{"tampered":true}')
  await expectRejected(visualDigest(changed), "SHA-256")
})

test("确定性派生固定 favicon 与升序 PNG-backed ICO，且只写 stage/assets", async () => {
  const fixture = await repositoryFixture("derive")
  const paths = createBuildPaths(identity, fixture.repositoryRoot)
  const packagesBefore = await treeDigest(path.join(fixture.repositoryRoot, "packages"))
  const digest = (await validateBrandAssets(paths.frameworkRoot)).digest

  const first = await deriveDesktopAssets(paths)
  const firstBytes = await Promise.all(
    [first.iconIco, first.faviconSvg, first.faviconPng, first.wordmarkSvg, first.wordmarkPng].map((file) =>
      readFile(file),
    ),
  )
  const second = await deriveDesktopAssets(paths)
  const secondBytes = await Promise.all(
    [second.iconIco, second.faviconSvg, second.faviconPng, second.wordmarkSvg, second.wordmarkPng].map((file) =>
      readFile(file),
    ),
  )

  expect(second).toEqual(first)
  expect(secondBytes).toEqual(firstBytes)
  expect(await validatePng(firstBytes[2])).toEqual({ width: 96, height: 96 })
  expect(parseIco(firstBytes[0])).toEqual(icoSizes.map((size) => ({ size, png: { width: size, height: size } })))
  expect(Object.values(first).every((file) => path.dirname(file) === path.join(paths.stageDir, "assets", digest))).toBe(
    true,
  )
  expect(await treeDigest(path.join(fixture.repositoryRoot, "packages"))).toBe(packagesBefore)
  expect(await Bun.file(first.faviconSvg).text()).toContain('href="./favicon.png"')
  expect(await Bun.file(first.wordmarkSvg).text()).toContain('href="./wordmark.png"')
  expect(firstBytes[4]).toEqual(await readFile(path.join(paths.frameworkRoot, "wordmark.png")))
})

test("已存在的非完整摘要目录保持原样且不可被派生覆盖", async () => {
  const fixture = await repositoryFixture("immutable-conflict")
  const paths = createBuildPaths(identity, fixture.repositoryRoot)
  const digest = (await validateBrandAssets(paths.frameworkRoot)).digest
  const directory = path.join(paths.stageDir, "assets", digest)
  const sentinel = path.join(directory, "sentinel.txt")
  await mkdir(directory, { recursive: true })
  await writeFile(sentinel, "old-target")

  await expectRejected(deriveDesktopAssets(paths), "不可变")
  expect(await Bun.file(sentinel).text()).toBe("old-target")
  expect(await readdir(directory)).toEqual(["sentinel.txt"])
})

test("并发派生原子发布同一摘要目录，loser 复用 winner 且不残留 temp", async () => {
  const fixture = await repositoryFixture("concurrent-publish")
  const paths = createBuildPaths(identity, fixture.repositoryRoot)
  const digest = (await validateBrandAssets(paths.frameworkRoot)).digest
  const directory = path.join(paths.stageDir, "assets", digest)
  const results = await Promise.all(Array.from({ length: 4 }, () => deriveDesktopAssets(paths)))

  expect(results.every((result) => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true)
  const published = await treeDigest(directory)
  expect(await deriveDesktopAssets(paths)).toEqual(results[0])
  expect(await treeDigest(directory)).toBe(published)
  expect((await readdir(path.dirname(directory))).some((entry) => entry.startsWith(".tmp-"))).toBe(false)
})

test("stage ancestor junction 被拒绝且不会写入或删除外部目录", async () => {
  const fixture = await repositoryFixture("junction")
  const paths = createBuildPaths(identity, fixture.repositoryRoot)
  const external = path.join(fixture.root, "external-workspaces")
  const sentinel = path.join(external, "sentinel.txt")
  await mkdir(external, { recursive: true })
  await writeFile(sentinel, "do-not-touch")
  await mkdir(paths.outputRoot, { recursive: true })
  await symlink(external, path.join(paths.outputRoot, "workspaces"), "junction")

  await expectRejected(deriveDesktopAssets(paths), "链接")
  expect(await Bun.file(sentinel).text()).toBe("do-not-touch")
  expect(await readdir(external)).toEqual(["sentinel.txt"])
})

test("premultiplied-alpha 缩放不产生透明彩色暗边且透明 RGB 固定为零", () => {
  expect(resizeRgba(new Uint8Array([255, 255, 255, 255, 255, 0, 0, 0]), 2, 1, 1)).toEqual(
    new Uint8Array([255, 255, 255, 128]),
  )
  expect(resizeRgba(new Uint8Array([255, 0, 0, 0]), 1, 1, 2)).toEqual(
    new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  )
})

async function temporarySnapshot(name: string) {
  const root = testRoot(name)
  await mkdir(root, { recursive: true })
  await Promise.all(
    [
      "brand.json",
      "app-icon.svg",
      "app-icon.png",
      "wordmark.svg",
      "wordmark.png",
      "tui.json",
      "snapshot-manifest.json",
    ].map((file) => cp(path.join(snapshotRoot, file), path.join(root, file))),
  )
  return root
}

async function repositoryFixture(name: string) {
  const root = testRoot(name)
  const repositoryRoot = path.join(root, "repository")
  await Promise.all([
    mkdir(path.join(repositoryRoot, "xcode/build"), { recursive: true }),
    mkdir(path.join(repositoryRoot, "packages/desktop/resources"), { recursive: true }),
    mkdir(path.join(repositoryRoot, "packages/app/public"), { recursive: true }),
    mkdir(path.join(repositoryRoot, "packages/ui"), { recursive: true }),
  ])
  await cp(snapshotRoot, path.join(repositoryRoot, "xcode/build/bluedcode"), { recursive: true })
  await Promise.all([
    writeFile(path.join(repositoryRoot, "packages/desktop/resources/sentinel.txt"), "desktop"),
    writeFile(path.join(repositoryRoot, "packages/app/public/sentinel.txt"), "app"),
    writeFile(path.join(repositoryRoot, "packages/ui/sentinel.txt"), "ui"),
  ])
  return { root, repositoryRoot }
}

async function updateManifest(root: string) {
  const files = Object.fromEntries(
    await Promise.all(
      ["brand.json", "app-icon.svg", "app-icon.png", "wordmark.svg", "wordmark.png", "tui.json"].map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(path.join(root, file)))
          .digest("hex"),
      ]),
    ),
  )
  await writeFile(path.join(root, "snapshot-manifest.json"), JSON.stringify({ frameworkVersion: 1, files }))
}

function parseIco(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect([view.getUint16(0, true), view.getUint16(2, true), view.getUint16(4, true)]).toEqual([0, 1, 7])
  let expectedOffset = 6 + 7 * 16
  return icoSizes.map((expectedSize, index) => {
    const entry = 6 + index * 16
    const size = bytes[entry] || 256
    const height = bytes[entry + 1] || 256
    const length = view.getUint32(entry + 8, true)
    const offset = view.getUint32(entry + 12, true)
    expect(size).toBe(expectedSize)
    expect(height).toBe(expectedSize)
    expect([
      bytes[entry + 2],
      bytes[entry + 3],
      view.getUint16(entry + 4, true),
      view.getUint16(entry + 6, true),
    ]).toEqual([0, 0, 1, 32])
    expect(offset).toBe(expectedOffset)
    expect(offset + length).toBeLessThanOrEqual(bytes.length)
    expectedOffset += length
    return { size, png: pngHeader(bytes.subarray(offset, offset + length)) }
  })
}

function pngHeader(bytes: Uint8Array) {
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function rewriteChunkCrc(bytes: Uint8Array, offset: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const length = view.getUint32(offset)
  view.setUint32(offset + 8 + length, crc32(bytes.subarray(offset + 4, offset + 8 + length)))
}

function pngFixture(width: number, height: number, idatLength: number) {
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return concatBytes([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunkFixture("IHDR", ihdr),
    pngChunkFixture("IDAT", new Uint8Array(idatLength)),
    pngChunkFixture("IEND", new Uint8Array()),
  ])
}

function pngChunkFixture(type: string, data: Uint8Array) {
  const bytes = new Uint8Array(data.length + 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, data.length)
  bytes.set(new TextEncoder().encode(type), 4)
  bytes.set(data, 8)
  view.setUint32(data.length + 8, crc32(bytes.subarray(4, data.length + 8)))
  return bytes
}

function concatBytes(parts: readonly Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  return value >>> 0
})

async function treeDigest(root: string) {
  const hash = createHash("sha256")
  const files = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
  for (const file of files) hash.update(path.relative(root, file)).update(await readFile(file))
  return hash.digest("hex")
}

async function expectRejected(promise: Promise<unknown>, message?: string) {
  let rejected = false
  try {
    await promise
  } catch (error) {
    rejected = true
    if (!(error instanceof Error)) throw new Error("Promise 拒绝值不是 Error", { cause: error })
    if (message) expect(error.message).toContain(message)
  }
  if (!rejected) throw new Error("预期 Promise 失败，实际成功")
}

function testRoot(name: string) {
  const root = path.resolve(
    import.meta.dir,
    "../../../../.xcode/bluedcode/task-5-tests",
    `${name}-${crypto.randomUUID()}`,
  )
  roots.push(root)
  return root
}

const commit = "0123456789abcdef0123456789abcdef01234567"
const identity: BuildIdentity = {
  channel: "dev",
  name: "BluedCode Dev",
  appId: "ai.bluedcode.desktop.dev",
  protocol: "bluedcode-dev",
  version: "1.18.18-dev-0123456789",
  commit,
  shortCommit: commit.slice(0, 10),
  artifactDirectoryName: "BluedCode-Dev-1.18.18-dev-0123456789",
  artifactName: "BluedCode-Dev.exe",
}
