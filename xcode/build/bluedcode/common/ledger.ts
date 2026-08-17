import { createHash } from "node:crypto"
import path from "node:path"
import type { CacheIsolation } from "./cache"
import { publishImmutableFile } from "./isolation"

export type LedgerStage = "server" | "main" | "preload" | "renderer"

export type UnifiedLedgerEvent = {
  stage: LedgerStage
  moduleId: string
  file: string
  inputSha256: string
  outputSha256: string
  rules: Array<{ id: string; hits: number }>
  productProfileSha256: string
}

export type UnifiedLedger = { version: 2; events: UnifiedLedgerEvent[] }

export async function writeUnifiedLedger(input: {
  isolation: CacheIsolation
  root: string
  events: readonly UnifiedLedgerEvent[]
}) {
  const ledger = { version: 2 as const, events: [...input.events].sort(compareEvents) }
  validateLedger(ledger)
  const content = `${JSON.stringify(ledger, null, 2)}\n`
  const sha256 = createHash("sha256").update(content).digest("hex")
  const file = path.join(input.root, `unified-ledger-${sha256}.json`)
  await publishImmutableFile(input.isolation, input.root, file, content, sha256)
  return { file, sha256, ledger }
}

export function validateLedger(ledger: UnifiedLedger): void {
  const keys = new Set<string>()
  for (const event of ledger.events) {
    if (!isStage(event.stage) || !event.moduleId || !event.file || !isDigest(event.inputSha256) || !isDigest(event.outputSha256))
      throw new Error("统一 ledger event 无效")
    if (!isDigest(event.productProfileSha256) || event.rules.some((rule) => !rule.id || !Number.isSafeInteger(rule.hits) || rule.hits < 0))
      throw new Error("统一 ledger event 摘要或规则无效")
    const key = `${event.stage}:${event.moduleId}:${event.file}`
    if (keys.has(key)) throw new Error(`统一 ledger event 重复: ${key}`)
    keys.add(key)
  }
}

function compareEvents(left: UnifiedLedgerEvent, right: UnifiedLedgerEvent) {
  return `${left.stage}:${left.moduleId}:${left.file}`.localeCompare(`${right.stage}:${right.moduleId}:${right.file}`)
}

function isStage(value: string): value is LedgerStage {
  return value === "server" || value === "main" || value === "preload" || value === "renderer"
}

function isDigest(value: string) {
  return /^[a-f0-9]{64}$/.test(value)
}
