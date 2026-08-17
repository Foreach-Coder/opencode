import { createHash } from "node:crypto"
import { Product, deriveChannelIdentity } from "../../../../packages/product/src"
import type { BuildBaseline, BuildIdentity, BuildRequest } from "./types"
import { hasDirtyBuildInputs, type Git, type GitResult } from "./git"

export type GitSourceState = {
  head: string
  branch: string
  trackedIndexSha256: string
  trackedContentSha256: string
}

export function parseBuildArgs(argv: string[]): BuildRequest {
  let channel: BuildRequest["channel"] | undefined
  let release: string | undefined
  let auditOnly = false

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--audit-only") {
      if (auditOnly) throw new Error("--audit-only 不能重复")
      auditOnly = true
      continue
    }
    const value = argv[index + 1]
    if (!value) throw new Error(`参数 ${argv[index]} 缺少值`)
    if (argv[index] === "--channel") {
      if (channel) throw new Error("--channel 不能重复")
      if (value !== "dev" && value !== "prod") throw new Error("--channel 只能是 dev 或 prod")
      channel = value
      index += 1
      continue
    }
    if (argv[index] === "--release") {
      if (release) throw new Error("--release 不能重复")
      release = value
      index += 1
      continue
    }
    throw new Error(`未知参数: ${argv[index]}`)
  }

  if (!channel) throw new Error("必须提供 --channel")
  if (auditOnly && channel !== "dev") throw new Error("--audit-only 仅适用于 dev")
  if (channel === "dev" && release) throw new Error("--release 仅适用于 prod")
  if (channel === "dev") return auditOnly ? { channel, auditOnly: true } : { channel }
  if (!release) throw new Error("prod 必须提供 --release")
  if (!isRelease(release)) throw new Error("--release 必须是有效的 YYMMDD-NN")
  return { channel, release }
}

export async function resolveBuildIdentity(
  request: BuildRequest,
  git: Git,
  baseline?: BuildBaseline,
): Promise<BuildIdentity> {
  const [head, shortHead, desktopPackage] = await Promise.all([
    requireGit(git.run(["rev-parse", "HEAD"]), "无法读取 Git commit"),
    requireGit(git.run(["rev-parse", "--short=10", "HEAD"]), "无法读取 Git 短 commit"),
    requireGit(git.run(["show", "HEAD:packages/desktop/package.json"]), "无法读取 Desktop 版本"),
  ])
  const commit = head.trim()
  const shortCommit = shortHead.trim()
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Git commit 必须是 40 位小写十六进制")
  if (!/^[a-f0-9]{10}$/.test(shortCommit)) throw new Error("Git 短 commit 必须是 10 位小写十六进制")
  if (shortCommit !== commit.slice(0, 10)) throw new Error("Git 短 commit 与完整 commit 不一致")

  const version = readDesktopVersion(desktopPackage)
  if (baseline && version !== baseline.desktopVersion) {
    throw new Error(`Desktop version ${version} 与受信基线 ${baseline.desktopVersion} 不匹配`)
  }
  const product = deriveChannelIdentity(Product.profile, request.channel)
  if (request.channel === "dev") {
    const buildVersion = `${version}-dev-${shortCommit}`
    return {
      channel: product.channel,
      name: product.displayName as BuildIdentity["name"],
      appId: product.appId as BuildIdentity["appId"],
      protocol: product.protocol as BuildIdentity["protocol"],
      version: buildVersion,
      commit,
      shortCommit,
      artifactName: `${product.displayName.replaceAll(" ", "-")}-${buildVersion}-windows-x64-portable.exe`,
    }
  }

  const buildVersion = `${version}-${request.release}-${shortCommit}`
  return {
    channel: product.channel,
    name: product.displayName as BuildIdentity["name"],
    appId: product.appId as BuildIdentity["appId"],
    protocol: product.protocol as BuildIdentity["protocol"],
    version: buildVersion,
    commit,
    shortCommit,
    artifactName: `${product.displayName.replaceAll(" ", "-")}-${buildVersion}-windows-x64-portable.exe`,
    tag: `${product.directoryName}-v${version}-${request.release}`,
  }
}

export async function assertTrackedBaseline(git: Git): Promise<void> {
  await assertCleanTrackedStatus(git)
}

async function assertCleanTrackedStatus(git: Git) {
  const status = await requireGit(
    git.run(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    "无法读取 Git 状态",
  )
  if (hasDirtyBuildInputs(status)) throw new Error("Git 工作区不干净：存在 tracked 或 untracked 变更")
}

export async function captureGitSourceState(git: Git): Promise<GitSourceState> {
  await assertCleanTrackedStatus(git)
  const [headOutput, branchOutput] = await Promise.all([
    requireGit(git.run(["rev-parse", "HEAD"]), "无法认证 Git HEAD"),
    requireGit(git.run(["rev-parse", "--abbrev-ref", "HEAD"]), "无法认证 Git branch"),
  ])
  const head = headOutput.trim()
  const branch = branchOutput.trim()
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error("Git source HEAD 必须是 40 位小写十六进制")
  if (!branch || branch === "HEAD" || branch.includes("\0") || /[\r\n]/.test(branch)) {
    throw new Error("Git source branch 必须是非 detached 的单行分支名")
  }
  const [index, content] = await Promise.all([
    requireGit(git.run(["ls-files", "--stage", "-z"]), "无法认证 tracked index"),
    requireGit(git.run(["ls-tree", "-r", "-z", "--full-tree", head]), "无法认证 tracked content"),
  ])
  await assertCleanTrackedStatus(git)
  const [headAfter, branchAfter] = await Promise.all([
    requireGit(git.run(["rev-parse", "HEAD"]), "无法复核 Git HEAD"),
    requireGit(git.run(["rev-parse", "--abbrev-ref", "HEAD"]), "无法复核 Git branch"),
  ])
  if (headAfter.trim() !== head || branchAfter.trim() !== branch)
    throw new Error("Git source capture 期间 HEAD 或 branch 变化")
  return {
    head,
    branch,
    trackedIndexSha256: sha256(index),
    trackedContentSha256: sha256(content),
  }
}

export function assertGitSourceUnchanged(before: GitSourceState, after: GitSourceState) {
  if (after.head !== before.head) throw new Error(`构建期间 Git HEAD 变化: ${before.head} -> ${after.head}`)
  if (after.branch !== before.branch) throw new Error(`构建期间 Git branch 变化: ${before.branch} -> ${after.branch}`)
  if (after.trackedIndexSha256 !== before.trackedIndexSha256) throw new Error("构建期间 tracked index 摘要变化")
  if (after.trackedContentSha256 !== before.trackedContentSha256)
    throw new Error("构建期间 tracked content 内容摘要变化")
}

export async function recertifyGitSource(git: Git, before: GitSourceState) {
  const after = await captureGitSourceState(git)
  assertGitSourceUnchanged(before, after)
  return after
}

export async function withCertifiedGitSource<Result>(
  git: Git,
  before: GitSourceState,
  action: (after: GitSourceState) => Promise<Result>,
) {
  return action(await recertifyGitSource(git, before))
}

async function requireGit(result: Promise<GitResult>, message: string) {
  const output = await result
  if (output.exitCode !== 0) throw new Error(`${message}: ${output.stderr.trim()}`)
  return output.stdout
}

function readDesktopVersion(desktopPackage: string) {
  const parsed: unknown = JSON.parse(desktopPackage)
  if (!parsed || typeof parsed !== "object" || !("version" in parsed) || typeof parsed.version !== "string") {
    throw new Error("Desktop package.json 缺少 version")
  }
  if (!/^\d+\.\d+\.\d+$/.test(parsed.version)) throw new Error("Desktop version 无效")
  return parsed.version
}

function isRelease(value: string) {
  const match = /^(\d{2})(\d{2})(\d{2})-(0[1-9]|[1-9]\d)$/.exec(value)
  if (!match) return false
  const date = new Date(Date.UTC(2000 + Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return (
    date.getUTCFullYear() === 2000 + Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  )
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
