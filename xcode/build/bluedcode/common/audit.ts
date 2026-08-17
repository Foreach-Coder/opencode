import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

export type AuditAllowance = {
  id: string
  path: string
  token: string
  expected: number | "any"
  classification: "forbidden" | "preserved" | "evidence"
  reason: string
}

export type AuditPolicy = {
  tokens: readonly string[]
  allow: readonly AuditAllowance[]
}

export type AuditOccurrence = {
  path: string
  token: string
  count: number
  allowanceId?: string
}

export type AuditReport = {
  scannedFiles: string[]
  allowed: AuditOccurrence[]
  unclassified: AuditOccurrence[]
  forbidden: AuditOccurrence[]
  preserved: AuditOccurrence[]
  evidence: AuditOccurrence[]
  passed: boolean
}

export function mergeAuditPolicies(...policies: readonly AuditPolicy[]): AuditPolicy {
  const tokens: string[] = []
  const allowanceIds = new Set<string>()
  const allow: AuditAllowance[] = []
  for (const policy of policies) {
    for (const token of policy.tokens) {
      if (!tokens.includes(token)) tokens.push(token)
    }
    for (const allowance of policy.allow) {
      if (allowanceIds.has(allowance.id)) throw new Error(`重复 allowance id：${allowance.id}`)
      allowanceIds.add(allowance.id)
      allow.push(allowance)
    }
  }
  return { tokens, allow }
}

export class AuditError extends Error {
  constructor(public readonly report: AuditReport) {
    super(`品牌审计失败：${report.unclassified.length} 项未分类或与 allowlist 不匹配`)
    this.name = "AuditError"
  }
}

export async function scanOutput(root: string, policy: AuditPolicy): Promise<AuditReport> {
  const files = await listFiles(root)
  const scannedFiles: string[] = []
  const occurrences: Array<AuditOccurrence & { matches: AuditAllowance[] }> = []

  for (const file of files) {
    const content = await readFile(path.join(root, ...file.split("/")))
    if (content.includes(0)) continue
    scannedFiles.push(file)
    const text = content.toString("utf8")
    policy.tokens.forEach((token) => {
      const count = countLiteral(text, token)
      if (!count) return
      occurrences.push({
        path: file,
        token,
        count,
        matches: policy.allow.filter((allowance) => allowance.token === token && matchesGlob(file, allowance.path)),
      })
    })
  }

  const singular = occurrences.filter((occurrence) => occurrence.matches.length === 1)
  const invalidAllowances = new Set(
    policy.allow
      .filter((allowance) => {
        const count = singular
          .filter((occurrence) => occurrence.matches[0].id === allowance.id)
          .reduce((total, occurrence) => total + occurrence.count, 0)
        if (allowance.classification === "forbidden") return count > 0
        return allowance.expected === "any" ? count < 1 : count !== allowance.expected
      })
      .map((allowance) => allowance.id),
  )
  const allowed = singular
    .filter((occurrence) => !invalidAllowances.has(occurrence.matches[0].id))
    .map(({ matches, ...occurrence }) => ({ ...occurrence, allowanceId: matches[0].id }))
  const unclassified = occurrences
    .filter((occurrence) => occurrence.matches.length !== 1 || invalidAllowances.has(occurrence.matches[0]?.id ?? ""))
    .map(({ matches, ...occurrence }) =>
      matches.length === 1 ? { ...occurrence, allowanceId: matches[0].id } : occurrence,
    )
  policy.allow
    .filter(
      (allowance) =>
        allowance.classification !== "forbidden" &&
        invalidAllowances.has(allowance.id) &&
        !occurrences.some((occurrence) => occurrence.matches.some((match) => match.id === allowance.id)),
    )
    .forEach((allowance) =>
      unclassified.push({ path: allowance.path, token: allowance.token, count: 0, allowanceId: allowance.id }),
    )

  const report = {
    scannedFiles,
    allowed,
    unclassified,
    forbidden: unclassified.filter((occurrence) => {
      const allowance = policy.allow.find((candidate) => candidate.id === occurrence.allowanceId)
      return !allowance || allowance.classification === "forbidden"
    }),
    preserved: allowed.filter((occurrence) => allowanceFor(policy, occurrence)?.classification === "preserved"),
    evidence: allowed.filter((occurrence) => allowanceFor(policy, occurrence)?.classification === "evidence"),
    passed: unclassified.length === 0,
  }
  if (!report.passed) throw new AuditError(report)
  return report
}

function allowanceFor(policy: AuditPolicy, occurrence: AuditOccurrence) {
  return policy.allow.find((allowance) => allowance.id === occurrence.allowanceId)
}

async function listFiles(root: string) {
  const files: string[] = []
  await visit("")
  return files.sort()

  async function visit(relative: string) {
    const entries = await readdir(path.join(root, ...relative.split("/").filter(Boolean)), { withFileTypes: true })
    await Promise.all(
      entries.map(async (entry) => {
        const child = relative ? `${relative}/${entry.name}` : entry.name
        if (entry.isDirectory()) return visit(child)
        if (entry.isFile()) files.push(child)
      }),
    )
  }
}

function countLiteral(content: string, token: string) {
  if (!token) throw new Error("审计 token 不能为空")
  let count = 0
  let cursor = 0
  while (cursor <= content.length - token.length) {
    const found = content.indexOf(token, cursor)
    if (found === -1) break
    count += 1
    cursor = found + token.length
  }
  return count
}

function matchesGlob(file: string, pattern: string) {
  const pathSegments = file.split("/")
  const patternSegments = pattern.replaceAll("\\", "/").split("/")
  return matchSegments(0, 0)

  function matchSegments(pathIndex: number, patternIndex: number): boolean {
    if (patternIndex === patternSegments.length) return pathIndex === pathSegments.length
    if (patternSegments[patternIndex] === "**") {
      return (
        matchSegments(pathIndex, patternIndex + 1) ||
        (pathIndex < pathSegments.length && matchSegments(pathIndex + 1, patternIndex))
      )
    }
    if (pathIndex === pathSegments.length) return false
    return (
      matchSegment(pathSegments[pathIndex], patternSegments[patternIndex]) &&
      matchSegments(pathIndex + 1, patternIndex + 1)
    )
  }
}

function matchSegment(value: string, pattern: string) {
  const memo = new Map<string, boolean>()
  return match(0, 0)

  function match(valueIndex: number, patternIndex: number): boolean {
    const key = `${valueIndex}:${patternIndex}`
    const cached = memo.get(key)
    if (cached !== undefined) return cached
    const result =
      patternIndex === pattern.length
        ? valueIndex === value.length
        : pattern[patternIndex] === "*"
          ? match(valueIndex, patternIndex + 1) || (valueIndex < value.length && match(valueIndex + 1, patternIndex))
          : valueIndex < value.length &&
            value[valueIndex] === pattern[patternIndex] &&
            match(valueIndex + 1, patternIndex + 1)
    memo.set(key, result)
    return result
  }
}
