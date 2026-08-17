import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { AuditError, mergeAuditPolicies, scanOutput } from "../common/audit"
import type { AuditAllowance, AuditPolicy } from "../common/audit"

async function fixture(files: Record<string, string | Uint8Array>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bluedcode-audit-"))
  await Promise.all(
    Object.entries(files).map(async ([file, content]) => {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true })
      await writeFile(path.join(root, file), content)
    }),
  )
  return root
}

function allowance(overrides: Partial<AuditAllowance>): AuditAllowance {
  return {
    id: "preserved",
    path: "**/*",
    token: "OpenCode Zen",
    expected: "any",
    classification: "preserved",
    reason: "上游专有名词必须保留",
    ...overrides,
  }
}

async function auditFailure(root: string, policy: AuditPolicy) {
  try {
    await scanOutput(root, policy)
    throw new Error("预期审计失败")
  } catch (error) {
    if (!(error instanceof AuditError)) throw error
    return error.report
  }
}

test("合并品牌与企业审计 policy 时拒绝重复 allowance id", () => {
  const one = {
    tokens: ["https://opencode.ai"],
    allow: [{ id: "same", path: "**/*.js", token: "x", expected: 1, classification: "preserved", reason: "a" }],
  } as const
  const two = {
    tokens: ["SENTRY_DSN"],
    allow: [{ id: "same", path: "**/*.js", token: "y", expected: 1, classification: "preserved", reason: "b" }],
  } as const

  expect(() => mergeAuditPolicies(one, two)).toThrow("重复 allowance id")
})

test("按多目录 glob 扫描并记录被保留的上游语义", async () => {
  const root = await fixture({
    "app/main.txt": "OpenCode Zen OPENCODE_CONFIG @opencode-ai/plugin .opencode",
    "app/nested/worker.txt": "OpenCode Zen",
  })
  try {
    const policy: AuditPolicy = {
      tokens: ["OpenCode Zen", "OPENCODE_CONFIG", "@opencode-ai/plugin", ".opencode"],
      allow: [
        allowance({ id: "zen", path: "app/**", token: "OpenCode Zen", expected: 2 }),
        allowance({ id: "env", path: "app/*.txt", token: "OPENCODE_CONFIG", expected: 1 }),
        allowance({ id: "package", path: "**/main.txt", token: "@opencode-ai/plugin", expected: "any" }),
        allowance({ id: "data", path: "app/main.txt", token: ".opencode", expected: 1 }),
      ],
    }
    const report = await scanOutput(root, policy)
    expect(report.passed).toBe(true)
    expect(report.scannedFiles).toEqual(["app/main.txt", "app/nested/worker.txt"])
    expect(report.unclassified).toEqual([])
    expect(report.allowed).toEqual([
      { path: "app/main.txt", token: "OpenCode Zen", count: 1, allowanceId: "zen" },
      { path: "app/main.txt", token: "OPENCODE_CONFIG", count: 1, allowanceId: "env" },
      { path: "app/main.txt", token: "@opencode-ai/plugin", count: 1, allowanceId: "package" },
      { path: "app/main.txt", token: ".opencode", count: 1, allowanceId: "data" },
      { path: "app/nested/worker.txt", token: "OpenCode Zen", count: 1, allowanceId: "zen" },
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("未分类协议、用户入口和发布标记均 fail closed 并携带 report", async () => {
  const root = await fixture({ "bundle.js": "opencode://open CLI WSL Sentry publish" })
  try {
    const policy: AuditPolicy = {
      tokens: ["opencode://", "CLI", "WSL", "Sentry", "publish"],
      allow: [],
    }
    try {
      await scanOutput(root, policy)
      throw new Error("预期审计失败")
    } catch (error) {
      expect(error).toBeInstanceOf(AuditError)
      if (!(error instanceof AuditError)) throw error
      expect(error.report.passed).toBe(false)
      expect(error.report.unclassified.map((item) => item.token)).toEqual([
        "opencode://",
        "CLI",
        "WSL",
        "Sentry",
        "publish",
      ])
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("重叠 allowlist 与 expected 聚合不符均视为未分类", async () => {
  const root = await fixture({ "app/main.txt": "OpenCode OpenCode" })
  try {
    const overlapping: AuditPolicy = {
      tokens: ["OpenCode"],
      allow: [
        allowance({ id: "broad", path: "**/*", token: "OpenCode", expected: "any" }),
        allowance({ id: "narrow", path: "app/*.txt", token: "OpenCode", expected: 2 }),
      ],
    }
    expect(await auditFailure(root, overlapping)).toMatchObject({
      unclassified: [{ path: "app/main.txt", token: "OpenCode", count: 2 }],
      passed: false,
    })

    const wrongCount: AuditPolicy = {
      tokens: ["OpenCode"],
      allow: [allowance({ id: "counted", path: "app/*.txt", token: "OpenCode", expected: 1 })],
    }
    expect(await auditFailure(root, wrongCount)).toMatchObject({
      allowed: [],
      unclassified: [{ path: "app/main.txt", token: "OpenCode", count: 2, allowanceId: "counted" }],
      passed: false,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("跳过包含 NUL 的二进制文件", async () => {
  const root = await fixture({ "asset.bin": new Uint8Array([79, 112, 101, 110, 0, 67, 111, 100, 101]) })
  try {
    const report = await scanOutput(root, { tokens: ["OpenCode"], allow: [] })
    expect(report).toEqual({
      scannedFiles: [],
      allowed: [],
      unclassified: [],
      forbidden: [],
      preserved: [],
      evidence: [],
      passed: true,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("审计分别报告 forbidden、preserved 与不计脆弱全局次数的 evidence", async () => {
  const root = await fixture({
    "bundle.js": "OpenCode Zen session.share session.share",
  })
  try {
    const policy: AuditPolicy = {
      tokens: ["install-cli", "OpenCode Zen", "session.share"],
      allow: [
        allowance({ id: "service-identity", token: "OpenCode Zen", classification: "preserved" }),
        allowance({ id: "share-key", token: "session.share", classification: "evidence", expected: "any" }),
      ],
    }
    const report = await scanOutput(root, policy)
    expect(report.passed).toBe(true)
    expect(report.forbidden).toEqual([])
    expect(report.preserved).toEqual([{ path: "bundle.js", token: "OpenCode Zen", count: 1, allowanceId: "service-identity" }])
    expect(report.evidence).toEqual([{ path: "bundle.js", token: "session.share", count: 2, allowanceId: "share-key" }])

    await writeFile(path.join(root, "bundle.js"), "OpenCode Zen install-cli")
    expect((await auditFailure(root, policy)).forbidden).toEqual([
      { path: "bundle.js", token: "install-cli", count: 1 },
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("显式 forbidden allowance 仅接受零命中", async () => {
  const root = await fixture({ "bundle.js": "const safe = true" })
  try {
    const policy: AuditPolicy = {
      tokens: ["install-cli"],
      allow: [
        allowance({ id: "cli-entrypoint", token: "install-cli", classification: "forbidden", expected: 0 }),
      ],
    }
    expect(await scanOutput(root, policy)).toMatchObject({ passed: true, forbidden: [] })

    await writeFile(path.join(root, "bundle.js"), 'const channel = "install-cli"')
    expect((await auditFailure(root, policy)).forbidden).toEqual([
      { path: "bundle.js", token: "install-cli", count: 1, allowanceId: "cli-entrypoint" },
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
