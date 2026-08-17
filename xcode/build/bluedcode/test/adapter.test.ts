import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { BuildIdentity } from "../common/types"
import { deriveBuildTargets } from "../common/adapter"
import { selectVersionAdapter } from "../common/adapter-registry"
import { adapter11818 } from "../version/1.18.18"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const identity: BuildIdentity = {
  channel: "prod",
  name: "BluedCode",
  appId: "ai.bluedcode.desktop",
  protocol: "bluedcode",
  version: "1.18.18-260815-01-31406ccc51",
  commit: adapter11818.commit,
  shortCommit: adapter11818.commit.slice(0, 10),
  artifactDirectoryName: "BluedCode-1.18.18-260815-01-31406ccc51",
  artifactName: "BluedCode-1.18.18-260815-01-31406ccc51-windows-x64.zip",
  tag: "bluedcode-v1.18.18-260815-01",
}

const sourceOwnedTargets = [
  "packages/core/src/models-dev.ts",
  "packages/opencode/src/provider/provider.ts",
  "packages/opencode/src/config/config.ts",
  "packages/opencode/src/provider/auth.ts",
  "packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts",
  "packages/opencode/src/server/routes/instance/httpapi/groups/provider.ts",
  "packages/opencode/src/server/routes/instance/httpapi/handlers/control.ts",
  "packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts",
  "packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts",
  "packages/opencode/src/server/shared/ui.ts",
  "packages/opencode/src/share/session.ts",
  "packages/opencode/src/server/routes/instance/httpapi/groups/session.ts",
  "packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts",
  "packages/desktop/src/main/server.ts",
]

function tracked(file: string) {
  return execFileSync("git", ["show", `${adapter11818.commit}:${file}`], {
    cwd: repoRoot,
    encoding: "utf8",
  })
}

describe("BluedCode 1.18.18 服务端策略适配", () => {
  test("公共流程不直接绑定 1.18.18 命名适配器", async () => {
    for (const file of [
      "build.ts",
      "common/audit.ts",
      "common/build.ts",
      "common/manifest.ts",
      "common/plugins.ts",
      "common/server.ts",
    ]) {
      const source = await readFile(path.join(import.meta.dir, "..", file), "utf8")
      expect(source).not.toContain("adapter11818")
    }
  })

  test("注册表只选择完整匹配的 tag、commit 与 Desktop version", () => {
    expect(
      selectVersionAdapter({
        tag: adapter11818.tag,
        commit: adapter11818.commit,
        desktopVersion: "1.18.18",
      }),
    ).toBe(adapter11818)
    expect(() =>
      selectVersionAdapter({ tag: "v9.99.99", commit: adapter11818.commit, desktopVersion: "1.18.18" }),
    ).toThrow("未注册")
    expect(() =>
      selectVersionAdapter({ tag: adapter11818.tag, commit: "0".repeat(40), desktopVersion: "1.18.18" }),
    ).toThrow("未注册")
    expect(() =>
      selectVersionAdapter({ tag: adapter11818.tag, commit: adapter11818.commit, desktopVersion: "9.99.99" }),
    ).toThrow("未注册")
  })

  test("ModuleContract 派生指纹、构建目标和 ledger 覆盖，且不保留运行时策略改写", () => {
    const targets = deriveBuildTargets(adapter11818)
    expect(new Set(targets.map((target) => target.moduleId)).size).toBe(targets.length)
    expect(targets.every((target) => adapter11818.modules.some((module) => module.id === target.moduleId))).toBe(true)
    expect(
      adapter11818.modules.some((module) => module.rules.some((rule) => rule.kind === "runtime-policy-rewrite")),
    ).toBe(false)
  })

  test("版本适配器不再保留企业业务 AST 规则文件", () => {
    const rules = [
      "enterprise-policy.ts",
      "enterprise-provider-ui.ts",
      "enterprise-public-surface.ts",
      "enterprise-share-ui.ts",
    ]
    for (const rule of rules) {
      expect(existsSync(path.join(import.meta.dir, "..", "version", "1.18.18", "rules", rule))).toBe(false)
    }
  })

  test("同源 locale 按实际 Electron 阶段声明，renderer 契约不会泄漏到 main", () => {
    const targets = deriveBuildTargets(adapter11818)
    expect(
      targets
        .filter((target) => target.file === "packages/app/src/i18n/desktop-native.ts")
        .map((target) => target.stage)
        .sort(),
    ).toEqual(["main", "renderer"])
    expect(
      targets.filter((target) => target.file === "packages/app/src/i18n/en.ts").map((target) => target.stage),
    ).toEqual(["renderer"])
  })

  test("源码能力门禁的上游链接残留由输出审计逐项说明", () => {
    expect(adapter11818.auditPolicy.allow).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "renderer-enterprise-share-translation-keys",
          classification: "evidence",
          expected: "any",
        }),
        expect.objectContaining({
          id: "renderer-enterprise-share-publish-translation-keys",
          classification: "evidence",
          expected: "any",
        }),
        expect.objectContaining({
          id: "renderer-enterprise-share-unpublish-translation-keys",
          classification: "evidence",
          expected: "any",
        }),
        expect.objectContaining({ id: "main-enterprise-github-residue", classification: "evidence", expected: "any" }),
        expect.objectContaining({
          id: "renderer-enterprise-changelog-residue",
          classification: "evidence",
          expected: "any",
        }),
        expect.objectContaining({
          id: "server-enterprise-installation-upgrade-symbol",
          classification: "evidence",
          expected: "any",
        }),
      ]),
    )
  })

  test("服务端企业策略由源码实现且适配器不再控制服务端语义节点", () => {
    expect(adapter11818.hookTargets).not.toEqual(expect.arrayContaining(sourceOwnedTargets))

    for (const file of sourceOwnedTargets) {
      const source = tracked(file)
      expect(adapter11818.fingerprints[file]).toBeUndefined()
      const result = adapter11818.transform(file, source, identity)
      expect(result.code).toBe(source)
      expect(result.records).toEqual([])
    }
  })
})
