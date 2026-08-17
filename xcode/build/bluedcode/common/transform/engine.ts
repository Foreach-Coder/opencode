import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { transformHtml } from "./html"
import { transformText } from "./text"
import { transformTypescript } from "./typescript"
import type { Replacement, TransformInput, TransformResult, TransformRule } from "./types"

export function transformModule(input: TransformInput, rules: readonly TransformRule[]): TransformResult {
  const records: TransformResult["records"] = []
  const code = rules.reduce((current, rule) => {
    if (normalizePath(rule.file) !== normalizePath(input.file)) {
      throw new Error(`规则 ${rule.id} 文件不匹配：${rule.file} !== ${input.file}`)
    }
    const before = sha256(current)
    const transformed =
      rule.kind === "exact-text"
        ? transformText(current, rule)
        : rule.kind === "html-attribute" || rule.kind === "html-text"
          ? transformHtml(current, rule)
          : transformTypescript(input.file, current, rule)
    const output = applyReplacements(current, transformed.replacements)
    records.push({ id: rule.id, file: rule.file, hits: transformed.hits, before, after: sha256(output) })
    return output
  }, input.code)
  return { code, records }
}

export async function writeTransformLedger(file: string, results: readonly TransformResult[]) {
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(
    file,
    `${JSON.stringify({ version: 1, records: results.flatMap((result) => result.records) }, null, 2)}\n`,
  )
}

function applyReplacements(code: string, replacements: readonly Replacement[]) {
  return [...replacements]
    .sort((left, right) => right.start - left.start)
    .reduce((current, replacement) => {
      if (replacement.start < 0 || replacement.end < replacement.start || replacement.end > current.length) {
        throw new Error("转换区间无效")
      }
      return current.slice(0, replacement.start) + replacement.text + current.slice(replacement.end)
    }, code)
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function normalizePath(value: string) {
  return value.replaceAll("\\", "/")
}
