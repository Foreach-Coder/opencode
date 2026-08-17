import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import ts from "typescript"
import type { ModuleContract, VersionAdapter } from "../common/adapter"

export type CandidateFingerprint = {
  id: string
  file: string
  stage: ModuleContract["stage"]
  fingerprint: string
  status: "candidate"
}

export type PrepareVersionReport = {
  accepted: false
  adapter: string
  candidateTag: string
  candidates: readonly CandidateFingerprint[]
  reportFile: string
}

export async function prepareVersion(input: {
  repositoryRoot: string
  adapter: VersionAdapter
  candidateTag: string
  runId: string
  baselineRef?: string
}): Promise<PrepareVersionReport> {
  assertCandidateTag(input.candidateTag)
  const directory = reportDirectory(input.repositoryRoot, input.runId)
  await assertIgnoredReportDirectory(input.repositoryRoot, directory)
  const candidates = await Promise.all(
    input.adapter.modules.map(async (module) => ({
      id: module.id,
      file: module.file,
      stage: module.stage,
      fingerprint: digest(normalize(module.file, await gitShow(input.repositoryRoot, input.baselineRef ?? "HEAD", module.file))),
      status: "candidate" as const,
    })),
  )
  const reportFile = path.join(directory, "prepare-version.json")
  const report: PrepareVersionReport = {
    accepted: false,
    adapter: input.adapter.tag,
    candidateTag: input.candidateTag,
    candidates,
    reportFile,
  }
  await mkdir(directory, { recursive: true })
  await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n")
  await writeFile(
    path.join(directory, "candidate-version.json"),
    JSON.stringify({ accepted: false, tag: input.candidateTag, adapter: input.adapter.tag, candidates }, null, 2) + "\n",
  )
  return report
}

export function reportDirectory(repositoryRoot: string, runId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) throw new Error("报告 runId 无效")
  const root = path.resolve(repositoryRoot)
  const directory = path.resolve(root, ".xcode", "bluedcode", "reports", runId)
  const relative = path.relative(root, directory)
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("报告目录超出 repositoryRoot")
  return directory
}

export async function assertIgnoredReportDirectory(repositoryRoot: string, directory: string) {
  const root = path.resolve(repositoryRoot)
  const relative = path.relative(root, directory).replaceAll("\\", "/")
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) throw new Error("报告目录超出 repositoryRoot")
  const process = Bun.spawn(["git", "-C", root, "check-ignore", "-q", "--", relative], { stdout: "pipe", stderr: "pipe" })
  if ((await process.exited) !== 0) throw new Error(`报告目录未被 Git 忽略：${relative}`)
}

function assertCandidateTag(candidateTag: string) {
  if (!/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(candidateTag)) throw new Error("candidateTag 无效")
}

export async function gitShow(repositoryRoot: string, ref: string, file: string) {
  assertRepositoryPath(file)
  const process = Bun.spawn(["git", "-C", repositoryRoot, "show", `${ref}:${file}`], { stdout: "pipe", stderr: "pipe" })
  if ((await process.exited) !== 0) throw new Error(`无法读取 Git 基线 ${ref}:${file}`)
  return new Response(process.stdout).text()
}

export function normalize(file: string, source: string) {
  const code = source.replaceAll("\r\n", "\n")
  if (!/\.(?:[cm]?[jt]sx?)$/.test(file)) return code.trimEnd()
  const parsed = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, false, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  return ts.createPrinter({ removeComments: false }).printFile(parsed).trimEnd()
}

export function digest(source: string) {
  return createHash("sha256").update(source).digest("hex")
}

function assertRepositoryPath(file: string) {
  if (!file || path.isAbsolute(file) || file.split(/[\\/]/).includes("..")) throw new Error("受控源码路径无效")
}
