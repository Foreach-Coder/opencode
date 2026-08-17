import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { lstat, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { createBuildPaths } from "../common/paths"
import { buildServer as buildServerInternal, type ServerBundle } from "../common/server"
import type { BuildIdentity } from "../common/types"
import { baseline } from "../version/1.18.18/baseline"
import { version11818Adapter } from "../version/1.18.18"

const commit = "0123456789abcdef0123456789abcdef01234567"
const roots: string[] = []
const buildServer: typeof buildServerInternal = (paths, identity, trustedBaseline) =>
  buildServerInternal(paths, identity, trustedBaseline, version11818Adapter)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test("server 使用受信 1.18.18、desktop channel 与上游 Bun.build 语义", async () => {
  const fixture = await serverFixture()
  const paths = createBuildPaths(identity("dev"), fixture.repositoryRoot)
  const previousModels = process.env.MODELS_DEV_API_JSON
  process.env.MODELS_DEV_API_JSON = fixture.modelsFile

  try {
    const bundle = await buildServer(paths, identity("dev"), baseline)
    const code = await Bun.file(bundle.file).text()

    expect(bundle.cacheHit).toBe(false)
    expect(bundle.version).toBe("1.18.18")
    expect(bundle.channel).toBe("desktop")
    expect(bundle.defines).toMatchObject({
      OPENCODE_VERSION: "'1.18.18'",
      OPENCODE_CHANNEL: "'desktop'",
    })
    expect(code).toContain("1.18.18")
    expect(code).toContain("desktop")
    expect(code).toContain("fixture-model")
    expect(code).not.toContain(identity("dev").version)
    expect(bundle.file.startsWith(paths.serverDir)).toBe(true)
    expect(await Bun.file(`${bundle.file}.map`).exists()).toBe(true)
    expect(bundle.size).toBe((await lstat(bundle.file)).size)
    expect(bundle.sourceMap.file).toBe(`${path.basename(bundle.file)}.map`)
    expect(bundle.sourceMap.size).toBe((await lstat(`${bundle.file}.map`)).size)
    expect(bundle.assets).toHaveLength(1)
    expect(bundle.assets[0]?.file).toMatch(/\.wasm$/)
    for (const asset of bundle.assets) {
      const file = path.join(path.dirname(bundle.file), ...asset.file.split("/"))
      expect(asset.size).toBe((await lstat(file)).size)
      expect(asset.digest).toBe(
        createHash("sha256")
          .update(await readFile(file))
          .digest("hex"),
      )
    }
  } finally {
    restoreEnv("MODELS_DEV_API_JSON", previousModels)
  }
})

test("server 写入带产品 Profile 摘要的统一 ledger event", async () => {
  const fixture = await serverFixture()
  const paths = createBuildPaths(identity("dev"), fixture.repositoryRoot)
  const previousModels = process.env.MODELS_DEV_API_JSON
  process.env.MODELS_DEV_API_JSON = fixture.modelsFile
  try {
    await buildServer(paths, identity("dev"), baseline)
    const files = await readdir(path.join(paths.stageDir, "ledger", "server"))
    const content = await readFile(
      path.join(paths.stageDir, "ledger", "server", files.find((file) => file.startsWith("unified-ledger-"))!),
      "utf8",
    )
    const ledger = JSON.parse(content) as { events: Array<{ stage: string; productProfileSha256: string }> }
    expect(ledger.events).toEqual([
      expect.objectContaining({ stage: "server", productProfileSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ])
  } finally {
    restoreEnv("MODELS_DEV_API_JSON", previousModels)
  }
})

test("server cache 以 exact schema 认证 entry、source map 与完整 WASM 集合", async () => {
  const fixture = await serverFixture()
  const dev = identity("dev")
  const paths = createBuildPaths(dev, fixture.repositoryRoot)
  const previousModels = process.env.MODELS_DEV_API_JSON
  process.env.MODELS_DEV_API_JSON = fixture.modelsFile

  try {
    const bundle = await buildServer(paths, dev, baseline)
    const cacheEntry = path.join(paths.cacheRoot, "server", bundle.cacheKey)
    const manifest = serverManifest(bundle)
    expect(JSON.parse(await readFile(path.join(cacheEntry, "result.json"), "utf8"))).toEqual(manifest)
    expect(Object.keys(manifest).sort()).toEqual(["assets", "digest", "file", "size", "sourceMap"])
    expect(manifest.assets).toHaveLength(1)

    await writeFile(path.join(cacheEntry, "payload", "unlisted.wasm"), new Uint8Array([0, 1, 2, 3]))
    await expectRejected(buildServer(paths, dev, baseline), "文件集合")
  } finally {
    restoreEnv("MODELS_DEV_API_JSON", previousModels)
  }
})

test("server materialize 拒绝缺失、额外与摘要被篡改的 WASM", async () => {
  for (const mutation of ["missing", "extra", "tamper"] as const) {
    const fixture = await serverFixture()
    const dev = identity("dev")
    const paths = createBuildPaths(dev, fixture.repositoryRoot)
    const previousModels = process.env.MODELS_DEV_API_JSON
    process.env.MODELS_DEV_API_JSON = fixture.modelsFile

    try {
      const bundle = await buildServer(paths, dev, baseline)
      const target = path.dirname(bundle.file)
      const asset = bundle.assets[0]
      if (!asset) throw new Error("测试 server 缺少 WASM")
      const file = path.join(target, ...asset.file.split("/"))
      if (mutation === "missing") await rm(file)
      if (mutation === "extra") await writeFile(path.join(target, "extra.wasm"), new Uint8Array([0, 1, 2, 3]))
      if (mutation === "tamper") {
        const content = await readFile(file)
        content[content.byteLength - 1] = content[content.byteLength - 1] === 0 ? 1 : 0
        await writeFile(file, content)
      }
      await expectRejected(buildServer(paths, dev, baseline), mutation === "tamper" ? "摘要" : "文件集合")
    } finally {
      restoreEnv("MODELS_DEV_API_JSON", previousModels)
    }
  }
})

test("server cache 跨 channel 命中并对 lock、adapter 与输入精确失效", async () => {
  const fixture = await serverFixture()
  const devPaths = createBuildPaths(identity("dev"), fixture.repositoryRoot)
  const prodPaths = createBuildPaths(identity("prod"), fixture.repositoryRoot)
  const previousModels = process.env.MODELS_DEV_API_JSON
  process.env.MODELS_DEV_API_JSON = fixture.modelsFile

  try {
    const first = await buildServer(devPaths, identity("dev"), baseline)
    const shared = await buildServer(prodPaths, identity("prod"), baseline)
    expect(first.cacheHit).toBe(false)
    expect(shared.cacheHit).toBe(true)
    expect(shared.digest).toBe(first.digest)

    await mkdir(path.join(fixture.repositoryRoot, "xcode/build/bluedcode/version/1.18.18/tests"))
    await writeFile(
      path.join(fixture.repositoryRoot, "xcode/build/bluedcode/version/1.18.18/tests/irrelevant.test.ts"),
      "test-only",
    )
    expect((await buildServer(devPaths, identity("dev"), baseline)).cacheHit).toBe(true)

    await writeFile(path.join(fixture.repositoryRoot, "bun.lock"), "lock-b")
    expect((await buildServer(devPaths, identity("dev"), baseline)).cacheHit).toBe(false)

    await writeFile(path.join(fixture.repositoryRoot, "xcode/build/bluedcode/version/1.18.18/adapter.ts"), "adapter-b")
    expect((await buildServer(devPaths, identity("dev"), baseline)).cacheHit).toBe(false)

    await writeFile(fixture.modelsFile, '{"name":"changed-model"}')
    expect((await buildServer(devPaths, identity("dev"), baseline)).cacheHit).toBe(false)
  } finally {
    restoreEnv("MODELS_DEV_API_JSON", previousModels)
  }
})

test("server 只写隔离目录且不接受越界输出或未受信版本", async () => {
  const fixture = await serverFixture()
  const dev = identity("dev")
  const paths = createBuildPaths(dev, fixture.repositoryRoot)
  const previousModels = process.env.MODELS_DEV_API_JSON
  process.env.MODELS_DEV_API_JSON = fixture.modelsFile

  try {
    const trackedBefore = await trackedDigest()
    await buildServer(paths, dev, baseline)
    expect(await trackedDigest()).toBe(trackedBefore)
    expect(paths.serverDir.startsWith(paths.workspaceRoot)).toBe(true)

    await expectRejected(
      buildServer({ ...paths, serverDir: path.join(fixture.repositoryRoot, "packages/out") }, dev, baseline),
      "隔离",
    )
    const forgedRoot = path.join(fixture.repositoryRoot, "packages", ".cache")
    await expectRejected(
      buildServer(
        {
          ...paths,
          outputRoot: forgedRoot,
          cacheRoot: path.join(forgedRoot, "cache"),
          workspaceRoot: path.join(forgedRoot, "workspace"),
          serverDir: path.join(forgedRoot, "workspace", "server"),
        },
        dev,
        baseline,
      ),
      ".xcode/bluedcode",
    )
    await expectRejected(buildServer(paths, { ...dev, version: "1.19.0-dev-0123456789" }, baseline), "受信版本")
  } finally {
    restoreEnv("MODELS_DEV_API_JSON", previousModels)
  }
})

test("trusted baseline 拒绝 identity 与两个 package 同时漂移到 1.19.0", async () => {
  const fixture = await serverFixture()
  const drifted = { ...identity("dev"), version: "1.19.0-dev-0123456789" }
  const paths = createBuildPaths(drifted, fixture.repositoryRoot)
  const previousModels = process.env.MODELS_DEV_API_JSON
  process.env.MODELS_DEV_API_JSON = fixture.modelsFile
  await mkdir(paths.versionRoot, { recursive: true })
  await Promise.all([
    writeFile(paths.opencodePackageFile, '{"version":"1.19.0"}'),
    writeFile(paths.desktopPackageFile, '{"version":"1.19.0","devDependencies":{"electron":"42.3.3"}}'),
    writeFile(path.join(paths.versionRoot, "adapter.ts"), "adapter-1.19"),
  ])

  try {
    await expectRejected(buildServer(paths, drifted, baseline), "受信版本")
  } finally {
    restoreEnv("MODELS_DEV_API_JSON", previousModels)
  }
})

test("workspace junction 被拒绝且不会删除外部 sentinel", async () => {
  const fixture = await serverFixture()
  const dev = identity("dev")
  const paths = createBuildPaths(dev, fixture.repositoryRoot)
  const external = path.join(fixture.root, "external-workspaces")
  const externalServer = path.join(external, path.basename(paths.workspaceRoot), "server")
  const sentinel = path.join(externalServer, "sentinel.txt")
  const previousModels = process.env.MODELS_DEV_API_JSON
  process.env.MODELS_DEV_API_JSON = fixture.modelsFile
  await mkdir(externalServer, { recursive: true })
  await writeFile(sentinel, "do-not-delete")
  await mkdir(paths.outputRoot, { recursive: true })
  await symlink(external, path.join(paths.outputRoot, "workspaces"), "junction")

  try {
    await expectRejected(buildServer(paths, dev, baseline), "链接")
    expect(await Bun.file(sentinel).text()).toBe("do-not-delete")
  } finally {
    restoreEnv("MODELS_DEV_API_JSON", previousModels)
  }
})

test("同 key 并发构建只从 cache winner 原子物化 versioned server", async () => {
  const fixture = await serverFixture()
  const dev = identity("dev")
  const paths = createBuildPaths(dev, fixture.repositoryRoot)
  const previousModels = process.env.MODELS_DEV_API_JSON
  process.env.MODELS_DEV_API_JSON = fixture.modelsFile

  try {
    const bundles = await Promise.all([buildServer(paths, dev, baseline), buildServer(paths, dev, baseline)])
    const expectedDirectory = path.join(paths.serverDir, bundles[0].cacheKey)

    expect(bundles.filter((bundle) => bundle.cacheHit)).toHaveLength(1)
    expect(bundles.filter((bundle) => !bundle.cacheHit)).toHaveLength(1)
    expect(bundles[0].file).toBe(bundles[1].file)
    expect(path.dirname(bundles[0].file)).toBe(expectedDirectory)
    expect(await Bun.file(bundles[0].file).exists()).toBe(true)
    expect((await readdir(paths.serverDir)).some((entry) => entry.startsWith(".tmp-"))).toBe(false)
  } finally {
    restoreEnv("MODELS_DEV_API_JSON", previousModels)
  }
})

for (const traversal of ["../victim.js", "nested/../../victim.js"]) {
  test(`拒绝被篡改 cache manifest traversal: ${traversal}`, async () => {
    const fixture = await serverFixture()
    const dev = identity("dev")
    const paths = createBuildPaths(dev, fixture.repositoryRoot)
    const previousModels = process.env.MODELS_DEV_API_JSON
    process.env.MODELS_DEV_API_JSON = fixture.modelsFile

    try {
      const bundle = await buildServer(paths, dev, baseline)
      const cacheEntry = path.join(paths.cacheRoot, "server", bundle.cacheKey)
      const victim = "outside-payload"
      const victimDigest = createHash("sha256").update(victim).digest("hex")
      const cacheVictim = path.join(cacheEntry, "victim.js")
      const materializedVictim = path.join(paths.serverDir, "victim.js")
      await Promise.all([writeFile(cacheVictim, victim), writeFile(materializedVictim, victim)])
      const manifest = serverManifest(bundle)
      await writeFile(
        path.join(cacheEntry, "result.json"),
        JSON.stringify({
          ...manifest,
          file: traversal,
          digest: victimDigest,
          size: Buffer.byteLength(victim),
          sourceMap: { ...manifest.sourceMap, file: `${traversal}.map` },
        }),
      )

      await expectRejected(buildServer(paths, dev, baseline), "manifest")
      expect(await Bun.file(cacheVictim).text()).toBe(victim)
      expect(await Bun.file(materializedVictim).text()).toBe(victim)
    } finally {
      restoreEnv("MODELS_DEV_API_JSON", previousModels)
    }
  })
}

test("拒绝 cache payload 内合法 manifest 路径的 nested junction", async () => {
  const fixture = await serverFixture()
  const dev = identity("dev")
  const paths = createBuildPaths(dev, fixture.repositoryRoot)
  const previousModels = process.env.MODELS_DEV_API_JSON
  process.env.MODELS_DEV_API_JSON = fixture.modelsFile

  try {
    const bundle = await buildServer(paths, dev, baseline)
    const cacheEntry = path.join(paths.cacheRoot, "server", bundle.cacheKey)
    const payload = path.join(cacheEntry, "payload")
    const sibling = path.join(paths.outputRoot, "cache-payload-sibling")
    const sentinel = path.join(sibling, "sentinel.txt")
    await mkdir(sibling, { recursive: true })
    await writeFile(sentinel, "do-not-touch")
    await symlink(sibling, path.join(payload, "nested"), "junction")

    await expectRejected(buildServer(paths, dev, baseline), "链接")
    expect(await Bun.file(sentinel).text()).toBe("do-not-touch")
  } finally {
    restoreEnv("MODELS_DEV_API_JSON", previousModels)
  }
})

test("拒绝 materialized target 内合法 manifest 路径的 nested junction", async () => {
  const fixture = await serverFixture()
  const dev = identity("dev")
  const paths = createBuildPaths(dev, fixture.repositoryRoot)
  const previousModels = process.env.MODELS_DEV_API_JSON
  process.env.MODELS_DEV_API_JSON = fixture.modelsFile

  try {
    const bundle = await buildServer(paths, dev, baseline)
    const target = path.join(paths.serverDir, bundle.cacheKey)
    const sibling = path.join(paths.outputRoot, "materialized-sibling")
    const sentinel = path.join(sibling, "sentinel.txt")
    await mkdir(sibling)
    await writeFile(sentinel, "do-not-touch")
    await symlink(sibling, path.join(target, "nested"), "junction")

    await expectRejected(buildServer(paths, dev, baseline), "链接")
    expect(await Bun.file(sentinel).text()).toBe("do-not-touch")
  } finally {
    restoreEnv("MODELS_DEV_API_JSON", previousModels)
  }
})

async function serverFixture() {
  const root = path.resolve(
    import.meta.dir,
    "../../../../.xcode/bluedcode/task-4-tests",
    `server-${crypto.randomUUID()}`,
  )
  const repositoryRoot = path.join(root, "repository")
  const modelsFile = path.join(root, "models.json")
  roots.push(root)
  await Promise.all(
    [
      "packages/opencode/src",
      "packages/desktop",
      "xcode/build/bluedcode/common",
      "xcode/build/bluedcode/version/1.18.18",
    ].map((directory) => mkdir(path.join(repositoryRoot, directory), { recursive: true })),
  )
  await Promise.all([
    writeFile(
      path.join(repositoryRoot, "packages/opencode/src/node.ts"),
      'import fixtureWasm from "./fixture.wasm" with { type: "file" }\nconsole.log(OPENCODE_VERSION, OPENCODE_CHANNEL, OPENCODE_MODELS_DEV.name, fixtureWasm)\n',
    ),
    writeFile(
      path.join(repositoryRoot, "packages/opencode/src/fixture.wasm"),
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
    ),
    writeFile(path.join(repositoryRoot, "packages/opencode/package.json"), '{"version":"1.18.18"}'),
    writeFile(
      path.join(repositoryRoot, "packages/desktop/package.json"),
      '{"version":"1.18.18","devDependencies":{"electron":"42.3.3"}}',
    ),
    writeFile(path.join(repositoryRoot, "bun.lock"), "lock-a"),
    writeFile(path.join(repositoryRoot, "xcode/build/bluedcode/common/framework.ts"), "framework-a"),
    writeFile(path.join(repositoryRoot, "xcode/build/bluedcode/version/1.18.18/adapter.ts"), "adapter-a"),
    writeFile(
      path.join(repositoryRoot, "xcode/build/bluedcode/snapshot-manifest.json"),
      JSON.stringify({ frameworkVersion: 1, files: { "app-icon.svg": "1".repeat(64), "tui.json": "2".repeat(64) } }),
    ),
    writeFile(modelsFile, '{"name":"fixture-model"}'),
  ])
  return { root, repositoryRoot, modelsFile }
}

function serverManifest(bundle: ServerBundle) {
  return {
    file: path.basename(bundle.file),
    digest: bundle.digest,
    size: bundle.size,
    sourceMap: bundle.sourceMap,
    assets: bundle.assets,
  }
}

function identity(channel: "dev" | "prod"): BuildIdentity {
  if (channel === "dev") {
    return {
      channel,
      name: "BluedCode Dev",
      appId: "ai.bluedcode.desktop.dev",
      protocol: "bluedcode-dev",
      version: "1.18.18-dev-0123456789",
      commit,
      shortCommit: commit.slice(0, 10),
      artifactDirectoryName: "BluedCode-Dev-1.18.18-dev-0123456789",
      artifactName: "BluedCode-Dev.exe",
    }
  }
  return {
    channel,
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
}

async function trackedDigest() {
  const repositoryRoot = path.resolve(import.meta.dir, "../../../..")
  const process = Bun.spawn(["git", "-C", repositoryRoot, "diff", "--no-ext-diff", "--binary"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, output, error] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(error)
  return Bun.hash(output)
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

async function expectRejected(promise: Promise<unknown>, message: string) {
  const error = await promise.then(
    () => new Error("预期 Promise 失败，实际成功"),
    (cause: unknown) => cause,
  )
  if (!(error instanceof Error)) throw new Error("Promise 拒绝值不是 Error")
  expect(error.message).toContain(message)
}
