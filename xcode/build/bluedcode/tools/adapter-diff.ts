import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import type { ModuleContract, VersionAdapter } from "../common/adapter"
import { assertIgnoredReportDirectory, digest, gitShow, normalize, reportDirectory } from "./prepare-version"

export type AdapterDiffCandidate = {
  file: string
  stage: ModuleContract["stage"]
  kind: "fingerprint" | "route" | "provider" | "renderer-connect"
  risk: "medium" | "high"
  baselineDigest?: string
  candidateDigest: string
  status: "candidate"
}

export type AdapterDiffReport = {
  accepted: false
  adapter: string
  baselineRef: string
  candidateRef: string
  candidates: readonly AdapterDiffCandidate[]
  reportFile: string
}

export async function diffAdapter(input: {
  repositoryRoot: string
  adapter: VersionAdapter
  baselineRef: string
  candidateRef: string
  runId: string
}): Promise<AdapterDiffReport> {
  const directory = reportDirectory(input.repositoryRoot, input.runId)
  await assertIgnoredReportDirectory(input.repositoryRoot, directory)
  const [baselineFiles, candidateFiles] = await Promise.all([
    gitFiles(input.repositoryRoot, input.baselineRef),
    gitFiles(input.repositoryRoot, input.candidateRef),
  ])
  const candidates = (
    await Promise.all(
      [...candidateFiles]
        .filter((file) => isSource(file))
        .map(async (file) => {
          const candidate = await gitShow(input.repositoryRoot, input.candidateRef, file)
          const baseline = baselineFiles.has(file) ? await gitShow(input.repositoryRoot, input.baselineRef, file) : undefined
          const candidateDigest = digest(normalize(file, candidate))
          const baselineDigest = baseline === undefined ? undefined : digest(normalize(file, baseline))
          if (baselineDigest === candidateDigest) return undefined
          return classify(file, candidate, baselineDigest, candidateDigest)
        }),
    )
  ).filter((candidate): candidate is AdapterDiffCandidate => Boolean(candidate))
  const reportFile = path.join(directory, "adapter-diff.json")
  const report: AdapterDiffReport = {
    accepted: false,
    adapter: input.adapter.tag,
    baselineRef: input.baselineRef,
    candidateRef: input.candidateRef,
    candidates,
    reportFile,
  }
  await mkdir(directory, { recursive: true })
  await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n")
  return report
}

async function gitFiles(repositoryRoot: string, ref: string) {
  const process = Bun.spawn(["git", "-C", repositoryRoot, "ls-tree", "-r", "--name-only", ref], {
    stdout: "pipe",
    stderr: "pipe",
  })
  if ((await process.exited) !== 0) throw new Error(`无法读取 Git 基线 ${ref}`)
  return new Set((await new Response(process.stdout).text()).split("\n").filter(Boolean))
}

function classify(file: string, source: string, baselineDigest: string | undefined, candidateDigest: string): AdapterDiffCandidate {
  const stage = stageFor(file)
  if (/\b(?:app|router)\.(?:get|post|put|patch|delete)\s*\(/.test(source)) {
    return { file, stage, kind: "route", risk: "high", baselineDigest, candidateDigest, status: "candidate" }
  }
  if (/\bProvider\b/.test(source)) {
    return { file, stage, kind: "provider", risk: "high", baselineDigest, candidateDigest, status: "candidate" }
  }
  if (stage === "renderer" && /\bconnect\b/i.test(source)) {
    return { file, stage, kind: "renderer-connect", risk: "high", baselineDigest, candidateDigest, status: "candidate" }
  }
  return { file, stage, kind: "fingerprint", risk: "medium", baselineDigest, candidateDigest, status: "candidate" }
}

function isSource(file: string) {
  return /^packages\//.test(file) && /\.(?:[cm]?[jt]sx?|json)$/.test(file)
}

function stageFor(file: string): ModuleContract["stage"] {
  if (/packages\/opencode\//.test(file)) return "server"
  if (/\/preload\//.test(file)) return "preload"
  if (/packages\/desktop\/src\/main\//.test(file)) return "main"
  return "renderer"
}
