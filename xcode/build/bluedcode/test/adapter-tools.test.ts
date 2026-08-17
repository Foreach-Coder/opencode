import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { diffAdapter } from "../tools/adapter-diff"
import { prepareVersion, reportDirectory } from "../tools/prepare-version"
import type { VersionAdapter } from "../common/adapter"

const adapter = {
  tag: "v1.18.18",
  commit: "0".repeat(40),
  desktopVersion: "1.18.18",
  modules: [
    {
      id: "server:bundle",
      file: "packages/opencode/src/node.ts",
      stage: "server",
      fingerprint: "a".repeat(64),
      rules: [],
    },
  ],
  fingerprints: {},
  rules: [],
  hookTargets: [],
  auditPolicy: { allow: [], preserved: [] },
  preservedIdentities: [],
  assets: {},
  productProfileSha256: "b".repeat(64),
  transform(file: string, code: string) {
    return { code, records: [] }
  },
} as VersionAdapter

test("prepare-version 只在忽略报告目录生成未接受的候选指纹", async () => {
  const repositoryRoot = await fixtureRepository()
  try {
    const trackedDigestBefore = await trackedDigest(repositoryRoot)
    const report = await prepareVersion({ repositoryRoot, adapter, candidateTag: "v1.19.0", runId: "prepare-test" })
    const trackedDigestAfter = await trackedDigest(repositoryRoot)

    expect(report.accepted).toBe(false)
    expect(report.candidates.every((item) => item.status === "candidate")).toBe(true)
    expect(trackedDigestAfter).toBe(trackedDigestBefore)
    expect(JSON.parse(await readFile(report.reportFile, "utf8"))).toMatchObject({ accepted: false })
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test("工具在报告目录未被 Git 忽略时失败且不写入报告", async () => {
  const repositoryRoot = await fixtureRepository({ ignoreReports: false })
  const directory = reportDirectory(repositoryRoot, "unignored-report")
  try {
    await expect(prepareVersion({ repositoryRoot, adapter, candidateTag: "v1.19.0", runId: "unignored-report" })).rejects.toThrow(
      "Git 忽略",
    )
    await expect(Bun.file(path.join(directory, "prepare-version.json")).exists()).resolves.toBe(false)
    await expect(
      diffAdapter({ repositoryRoot, adapter, baselineRef: "HEAD", candidateRef: "HEAD", runId: "unignored-report" }),
    ).rejects.toThrow("Git 忽略")
    await expect(Bun.file(path.join(directory, "adapter-diff.json")).exists()).resolves.toBe(false)
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test("prepare-version 拒绝非法 candidateTag", async () => {
  const repositoryRoot = await fixtureRepository()
  try {
    await expect(prepareVersion({ repositoryRoot, adapter, candidateTag: "../invalid", runId: "invalid-tag" })).rejects.toThrow(
      "candidateTag",
    )
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test("adapter-diff 将新 route、Provider 和 renderer connect button 保留为候选", async () => {
  const repositoryRoot = await fixtureRepository()
  try {
    await mkdir(path.join(repositoryRoot, "packages/app/src"), { recursive: true })
    await writeFile(path.join(repositoryRoot, "packages/opencode/src/new-route.ts"), 'router.get("/new", () => Response.json({}))\n')
    await writeFile(path.join(repositoryRoot, "packages/opencode/src/provider.ts"), "export const Provider = { id: 'new-provider' }\n")
    await writeFile(path.join(repositoryRoot, "packages/app/src/connect.tsx"), "export function ConnectButton() { return <button>Connect</button> }\n")
    await git(repositoryRoot, "add", ".")
    await git(repositoryRoot, "commit", "-m", "新增候选源码")

    const trackedDigestBefore = await trackedDigest(repositoryRoot)
    const report = await diffAdapter({ repositoryRoot, adapter, baselineRef: "HEAD~1", candidateRef: "HEAD", runId: "diff-test" })
    const trackedDigestAfter = await trackedDigest(repositoryRoot)

    expect(report.accepted).toBe(false)
    expect(report.candidates.every((item) => item.status === "candidate")).toBe(true)
    expect(report.candidates.map((item) => item.kind).sort()).toEqual(["provider", "renderer-connect", "route"])
    expect(report.candidates.map((item) => item.risk).sort()).toEqual(["high", "high", "high"])
    expect(trackedDigestAfter).toBe(trackedDigestBefore)
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test("子仓报告目录被 Git 忽略", async () => {
  const repositoryRoot = path.resolve(import.meta.dir, "../../../..")
  expect(await checkIgnored(repositoryRoot, ".xcode/bluedcode/reports/adapter-tools-test/report.json")).toBe(true)
})

async function fixtureRepository(options: { ignoreReports?: boolean } = {}) {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "bluedcode-adapter-tools-"))
  await mkdir(path.join(repositoryRoot, "packages/opencode/src"), { recursive: true })
  await writeFile(path.join(repositoryRoot, ".gitignore"), options.ignoreReports === false ? "" : ".xcode/\n")
  await writeFile(path.join(repositoryRoot, "packages/opencode/src/node.ts"), "export const node = true\n")
  await git(repositoryRoot, "init")
  await git(repositoryRoot, "config", "user.email", "test@example.com")
  await git(repositoryRoot, "config", "user.name", "Test")
  await git(repositoryRoot, "add", ".")
  await git(repositoryRoot, "commit", "-m", "初始基线")
  return repositoryRoot
}

async function checkIgnored(repositoryRoot: string, file: string) {
  const process = Bun.spawn(["git", "-C", repositoryRoot, "check-ignore", "-q", "--", file], { stdout: "pipe", stderr: "pipe" })
  return (await process.exited) === 0
}

async function git(repositoryRoot: string, ...args: string[]) {
  const process = Bun.spawn(["git", "-C", repositoryRoot, ...args], { stdout: "pipe", stderr: "pipe" })
  if ((await process.exited) !== 0) throw new Error(await new Response(process.stderr).text())
}

async function trackedDigest(repositoryRoot: string) {
  const process = Bun.spawn(["git", "-C", repositoryRoot, "ls-files", "-z"], { stdout: "pipe", stderr: "pipe" })
  if ((await process.exited) !== 0) throw new Error(await new Response(process.stderr).text())
  const files = await new Response(process.stdout).text()
  const hash = createHash("sha256")
  for (const file of files.split("\0").filter(Boolean).sort()) hash.update(file).update("\0").update(await readFile(path.join(repositoryRoot, file)))
  return hash.digest("hex")
}
