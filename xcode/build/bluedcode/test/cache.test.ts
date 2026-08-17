import { expect, test } from "bun:test"
import { mkdir, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { cacheKey, withCache, type CacheKeyInput } from "../common/cache"
import { createBuildPaths } from "../common/paths"
import type { BuildIdentity } from "../common/types"

const commit = "0123456789abcdef0123456789abcdef01234567"

const devIdentity: BuildIdentity = {
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

const prodIdentity: BuildIdentity = {
  channel: "prod",
  name: "BluedCode",
  appId: "ai.bluedcode.desktop",
  protocol: "bluedcode",
  version: "1.18.18-260815-01-0123456789",
  commit,
  shortCommit: commit.slice(0, 10),
  artifactDirectoryName: "BluedCode-1.18.18-260815-01-0123456789",
  artifactName: "BluedCode.exe",
  tag: "bluedcode-v1.18.18-260815-01",
}

const commonInput = {
  commit,
  bunLockDigest: "1".repeat(64),
  bunVersion: "1.3.14",
  electronVersion: "42.3.3",
  platform: "win32" as const,
  arch: "x64" as const,
  frameworkDigest: "2".repeat(64),
  adapterDigest: "3".repeat(64),
  inputDigest: "4".repeat(64),
}

test("server 跨 channel 共享，身份相关阶段按完整身份隔离", () => {
  const serverDev: CacheKeyInput = { unit: "server", identity: devIdentity, ...commonInput }
  const serverProd: CacheKeyInput = { unit: "server", identity: prodIdentity, ...commonInput }
  const rendererDev: CacheKeyInput = { unit: "renderer", identity: devIdentity, ...commonInput }
  const rendererProd: CacheKeyInput = { unit: "renderer", identity: prodIdentity, ...commonInput }

  expect(cacheKey(serverDev)).toBe(cacheKey(serverProd))
  expect(cacheKey(rendererDev)).not.toBe(cacheKey(rendererProd))
})

test("相同身份不因对象属性插入顺序产生不同缓存键", () => {
  const reordered: BuildIdentity = {
    artifactName: devIdentity.artifactName,
    artifactDirectoryName: devIdentity.artifactDirectoryName,
    shortCommit: devIdentity.shortCommit,
    commit: devIdentity.commit,
    version: devIdentity.version,
    protocol: devIdentity.protocol,
    appId: devIdentity.appId,
    name: devIdentity.name,
    channel: devIdentity.channel,
  }

  expect(cacheKey({ unit: "renderer", identity: reordered, ...commonInput })).toBe(
    cacheKey({ unit: "renderer", identity: devIdentity, ...commonInput }),
  )
  expect(createBuildPaths(reordered).workspaceRoot).toBe(createBuildPaths(devIdentity).workspaceRoot)
})

test("bun.lock、adapter 与输入摘要分别精确使缓存失效", () => {
  const input: CacheKeyInput = { unit: "server", identity: devIdentity, ...commonInput }
  const original = cacheKey(input)

  expect(cacheKey({ ...input, bunLockDigest: "5".repeat(64) })).not.toBe(original)
  expect(cacheKey({ ...input, adapterDigest: "6".repeat(64) })).not.toBe(original)
  expect(cacheKey({ ...input, inputDigest: "7".repeat(64) })).not.toBe(original)
  expect(cacheKey({ ...input, frameworkDigest: "8".repeat(64) })).not.toBe(original)
})

test("成功项原子提交并在第二次构建命中", async () => {
  const root = testRoot("hit")
  const unit = path.join(root, "cache", "server")
  const key = "a".repeat(64)
  let builds = 0
  const isolation = await testIsolation(root)

  try {
    const first = await withCache(
      unit,
      key,
      async (directory) => {
        builds += 1
        await mkdir(path.join(directory, "files"), { recursive: true })
        await writeFile(path.join(directory, "files", "bundle.js"), "fixture")
        return { file: "bundle.js", digest: "b".repeat(64) }
      },
      isolation,
    )
    const second = await withCache(
      unit,
      key,
      async () => {
        builds += 1
        return { file: "unexpected.js", digest: "c".repeat(64) }
      },
      isolation,
    )

    expect(first.hit).toBe(false)
    expect(second.hit).toBe(true)
    expect(second.value).toEqual(first.value)
    expect(second.directory).toBe(first.directory)
    expect(await Bun.file(path.join(second.directory, "files", "bundle.js")).text()).toBe("fixture")
    expect(builds).toBe(1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("失败写入被清理且不会形成可命中项", async () => {
  const root = testRoot("failure")
  const unit = path.join(root, "cache", "server")
  const key = "d".repeat(64)
  const isolation = await testIsolation(root)

  try {
    await expectRejected(
      withCache(
        unit,
        key,
        async (directory) => {
          await writeFile(path.join(directory, "partial.txt"), "partial")
          throw new Error("fixture failure")
        },
        isolation,
      ),
      "fixture failure",
    )

    expect((await readdir(unit)).some((entry) => entry.includes(key))).toBe(false)
    const recovered = await withCache(unit, key, async () => ({ recovered: true }), isolation)
    expect(recovered).toMatchObject({ hit: false, value: { recovered: true } })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("同键并发 miss 只原子提交一个完整 winner", async () => {
  const root = testRoot("concurrent")
  const unit = path.join(root, "cache", "server")
  const key = "e".repeat(64)
  const isolation = await testIsolation(root)
  let arrivals = 0
  let release = () => {}
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })

  try {
    const build = (marker: string) =>
      withCache(
        unit,
        key,
        async (directory) => {
          arrivals += 1
          if (arrivals === 2) release()
          await barrier
          await mkdir(path.join(directory, "payload"))
          await writeFile(path.join(directory, "payload", "bundle.js"), marker)
          return { marker }
        },
        isolation,
      )
    const results = await Promise.all([build("first-complete"), build("second-complete")])

    expect(arrivals).toBe(2)
    expect(results.filter((result) => result.hit)).toHaveLength(1)
    expect(results.filter((result) => !result.hit)).toHaveLength(1)
    expect(results[0].directory).toBe(results[1].directory)
    expect(results[0].value).toEqual(results[1].value)
    expect(await Bun.file(path.join(results[0].directory, "payload", "bundle.js")).text()).toBe(results[0].value.marker)
    expect((await readdir(unit)).some((entry) => entry.startsWith(".tmp-"))).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("失败回调将 cache temp 替换为 junction 时拒绝递归清理", async () => {
  const root = testRoot("junction")
  const unit = path.join(root, "cache", "server")
  const external = path.join(root, "external")
  const sentinel = path.join(external, "sentinel.txt")
  const key = "f".repeat(64)
  const isolation = await testIsolation(root)
  await mkdir(external, { recursive: true })
  await writeFile(sentinel, "do-not-delete")

  try {
    await expectRejected(
      withCache(
        unit,
        key,
        async (directory) => {
          await rm(directory, { recursive: true })
          await symlink(external, directory, "junction")
          throw new Error("fixture failure")
        },
        isolation,
      ),
      "链接",
    )
    expect(await Bun.file(sentinel).text()).toBe("do-not-delete")
    expect((await readdir(unit)).some((entry) => entry === key)).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("cache ancestor junction 不会把普通 unit 目录写到 trusted root 外", async () => {
  const root = testRoot("ancestor-junction")
  const external = `${root}-external`
  const sentinel = path.join(external, "sentinel.txt")
  const isolation = await testIsolation(root)
  await mkdir(external, { recursive: true })
  await writeFile(sentinel, "do-not-touch")
  await symlink(external, path.join(root, "cache"), "junction")

  try {
    await expectRejected(
      withCache(path.join(root, "cache", "server"), "9".repeat(64), async () => ({ built: true }), isolation),
      "链接",
    )
    expect(await Bun.file(sentinel).text()).toBe("do-not-touch")
    expect(await readdir(external)).toEqual(["sentinel.txt"])
  } finally {
    await Promise.all([rm(root, { recursive: true, force: true }), rm(external, { recursive: true, force: true })])
  }
})

test("构建路径全部隔离在 .xcode/bluedcode 且 channel workspace 分离", () => {
  const repositoryRoot = path.resolve(import.meta.dir, "../../../..")
  const dev = createBuildPaths(devIdentity, repositoryRoot)
  const prod = createBuildPaths(prodIdentity, repositoryRoot)
  const isolatedRoot = path.join(repositoryRoot, ".xcode", "bluedcode")

  expect(dev.outputRoot).toBe(isolatedRoot)
  expect(dev.workspaceRoot.startsWith(isolatedRoot)).toBe(true)
  expect(dev.serverDir.startsWith(dev.workspaceRoot)).toBe(true)
  expect(dev.stageDir.startsWith(dev.workspaceRoot)).toBe(true)
  expect(dev.outDir.startsWith(dev.workspaceRoot)).toBe(true)
  expect(dev.cacheRoot).toBe(prod.cacheRoot)
  expect(dev.workspaceRoot).not.toBe(prod.workspaceRoot)
})

function testRoot(name: string) {
  return path.resolve(import.meta.dir, "../../../../.xcode/bluedcode/task-4-tests", `${name}-${crypto.randomUUID()}`)
}

async function testIsolation(root: string) {
  await mkdir(root, { recursive: true })
  return { lexicalRoot: root, canonicalRoot: await realpath(root) }
}

async function expectRejected(promise: Promise<unknown>, message: string) {
  const error = await promise.then(
    () => new Error("预期 Promise 失败，实际成功"),
    (cause: unknown) => cause,
  )
  if (!(error instanceof Error)) throw new Error("Promise 拒绝值不是 Error")
  expect(error.message).toContain(message)
}
