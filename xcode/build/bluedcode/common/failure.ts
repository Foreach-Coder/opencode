import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

export type FailureStage = "preflight" | "server" | "main" | "preload" | "renderer" | "package" | "audit"

export type FailureContext = {
  stage: FailureStage
  code: string
  lastModule: string | null
  ledgerPath: string | null
  symbolBundlePath: string | null
}

const failureContext = Symbol("bluedcode.failure-context")

export function withFailureContext(error: unknown, context: FailureContext): Error {
  const value = error instanceof Error ? error : new Error(String(error))
  Object.defineProperty(value, failureContext, { configurable: false, enumerable: false, value: context })
  return value
}

export function readFailureContext(error: unknown): FailureContext | undefined {
  return error instanceof Error ? (error as Error & { [failureContext]?: FailureContext })[failureContext] : undefined
}

export function collectConfiguredSecrets(values: readonly unknown[]): string[] {
  const secrets = new Set<string>()
  for (const value of values) visit(value, false)
  return [...secrets]

  function visit(value: unknown, sensitive: boolean): void {
    if (typeof value === "string") {
      if (sensitive && value) secrets.add(value)
      try {
        visit(JSON.parse(value), sensitive)
      } catch {
        // A configuration scalar is not necessarily JSON.
      }
      return
    }
    if (Array.isArray(value)) return value.forEach((item) => visit(item, sensitive))
    if (!value || typeof value !== "object") return
    for (const [key, item] of Object.entries(value)) {
      visit(item, sensitive || /(?:api.?key|token|secret|password|credential|authorization|provider)/i.test(key))
    }
  }
}

export async function writeFailureReport(input: FailureContext & {
  root: string
  error: unknown
  gitSha256: string
  productProfileSha256: string
  frameworkSha256: string
  adapterSha256: string
  secrets?: readonly string[]
}) {
  const error = input.error instanceof Error ? input.error : new Error(String(input.error))
  const sanitize = (value: string) =>
    (input.secrets ?? []).reduce((result, secret) => (secret ? result.replaceAll(secret, "[REDACTED]") : result), value)
  const report = {
    version: 1,
    stage: input.stage,
    code: input.code,
    message: sanitize(error.message),
    cause: sanitize(String(error.cause ?? "")),
    stack: sanitize(error.stack ?? ""),
    gitSha256: input.gitSha256,
    productProfileSha256: input.productProfileSha256,
    frameworkSha256: input.frameworkSha256,
    adapterSha256: input.adapterSha256,
    lastModule: input.lastModule,
    ledgerPath: input.ledgerPath,
    symbolBundlePath: input.symbolBundlePath,
  }
  const content = `${JSON.stringify(report, null, 2)}\n`
  const directory = path.join(input.root, "failures")
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, `failure-${createHash("sha256").update(content).digest("hex")}.json`)
  await writeFile(file, content, { flag: "wx" })
  return file
}
