import type { Git, GitResult } from "./git"

const releaseTag = /^bluedcode-v(\d+\.\d+\.\d+)-(\d{6})-(\d{2})$/

export function validateReleaseSequence(tags: readonly string[], release: string) {
  const proposed = requireRelease(release)
  const ledger = tags.flatMap((tag) => {
    const match = releaseTag.exec(tag.trim())
    if (!match) return []
    requireDate(match[2])
    const sequence = Number(match[3])
    if (sequence < 1 || sequence > 99) throw new Error(`发行账本序号必须是 01..99: ${tag}`)
    return [{ tag, date: match[2], sequence }]
  })
  const byDate = Map.groupBy(ledger, (entry) => entry.date)
  for (const [date, entries] of byDate) {
    const sequences = entries.map((entry) => entry.sequence).sort((left, right) => left - right)
    for (const [index, sequence] of sequences.entries()) {
      const expected = index + 1
      if (sequence < expected) throw new Error(`发行账本 ${date}-${String(sequence).padStart(2, "0")} 跨版本重复`)
      if (sequence > expected) {
        throw new Error(`发行账本 ${date} 序号必须从 01 连续，缺少 ${String(expected).padStart(2, "0")}`)
      }
    }
  }
  const newestDate = ledger
    .map((entry) => entry.date)
    .sort((left, right) => left.localeCompare(right))
    .at(-1)
  if (newestDate && proposed.date < newestDate) {
    throw new Error(`发行日期 ${proposed.date} 不得早于账本最新日期 ${newestDate}`)
  }
  const sameDay = byDate.get(proposed.date) ?? []
  const expected = sameDay.length ? Math.max(...sameDay.map((entry) => entry.sequence)) + 1 : 1
  if (expected > 99) throw new Error(`${proposed.date} 的 BluedCode 发行序号已耗尽`)
  if (proposed.sequence !== expected) {
    throw new Error(`${release} 不符合全局发行账本，同日下一序号应为 ${String(expected).padStart(2, "0")}`)
  }
}

export async function refreshReleaseLedger(git: Git, release: string) {
  await requireGit(git.run(["fetch", "--tags"]), "刷新远端 tag 失败")
  const output = await requireGit(git.run(["tag", "--list", "bluedcode-v*"]), "读取 BluedCode tag 失败")
  const tags = output
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter(Boolean)
  validateReleaseSequence(tags, release)
  return tags
}

export function createAnnotatedTagCommand(input: {
  artifactName: string
  artifactSha256: string
  commit: string
  tag: string
  version: string
}) {
  if (!/^bluedcode-v\d+\.\d+\.\d+-\d{6}-\d{2}$/.test(input.tag)) throw new Error("目标 tag 无效")
  if (!/^\d+\.\d+\.\d+-\d{6}-\d{2}-[a-f0-9]{10}$/.test(input.version)) throw new Error("正式版本无效")
  if (input.tag !== `bluedcode-v${input.version.replace(/-[a-f0-9]{10}$/, "")}`) {
    throw new Error("目标 tag 与正式版本不一致")
  }
  if (!/^[a-f0-9]{40}$/.test(input.commit)) throw new Error("annotated tag commit 无效")
  if (!/^[a-f0-9]{64}$/.test(input.artifactSha256)) throw new Error("annotated tag 产物摘要无效")
  if (!/^BluedCode-[A-Za-z0-9.-]+-windows-x64-portable\.exe$/.test(input.artifactName)) {
    throw new Error("annotated tag 产物名无效")
  }
  return `git tag -a ${input.tag} ${input.commit} -m "发布 BluedCode ${input.version} Windows x64 Portable；产物 ${input.artifactName}；SHA-256 ${input.artifactSha256}"`
}

async function requireGit(result: Promise<GitResult>, message: string) {
  const output = await result
  if (output.exitCode !== 0) throw new Error(`${message}: ${output.stderr.trim()}`)
  return output.stdout
}

function requireRelease(value: string) {
  const match = /^(\d{6})-(\d{2})$/.exec(value)
  if (!match || match[2] === "00") throw new Error("发行号必须是 YYMMDD-NN")
  requireDate(match[1])
  return { date: match[1], sequence: Number(match[2]) }
}

function requireDate(value: string) {
  const match = /^(\d{2})(\d{2})(\d{2})$/.exec(value)
  if (!match) throw new Error(`发行日期无效: ${value}`)
  const date = new Date(Date.UTC(2000 + Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (
    date.getUTCFullYear() !== 2000 + Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) {
    throw new Error(`发行日期无效: ${value}`)
  }
}
