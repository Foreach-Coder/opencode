import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import path from "node:path"
import type { BuildIdentity } from "../common/types"
import { deriveBuildTargets } from "../common/adapter"
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
  artifactName: "BluedCode-1.18.18-260815-01-31406ccc51-windows-x64-portable.exe",
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
  test("ModuleContract 派生指纹、构建目标和 ledger 覆盖，且不保留运行时策略改写", () => {
    const targets = deriveBuildTargets(adapter11818)
    expect(new Set(targets.map((target) => target.moduleId)).size).toBe(targets.length)
    expect(targets.every((target) => adapter11818.modules.some((module) => module.id === target.moduleId))).toBe(true)
    expect(adapter11818.modules.some((module) => module.rules.some((rule) => rule.kind === "runtime-policy-rewrite"))).toBe(
      false,
    )
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
        expect.objectContaining({ id: "renderer-enterprise-share-translation-keys", expected: 1151 }),
        expect.objectContaining({ id: "renderer-enterprise-share-publish-translation-keys", expected: 128 }),
        expect.objectContaining({ id: "renderer-enterprise-share-unpublish-translation-keys", expected: 128 }),
        expect.objectContaining({ id: "main-enterprise-github-residue", expected: 2 }),
        expect.objectContaining({ id: "renderer-enterprise-changelog-residue", expected: 1 }),
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
