import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { Product } from "../../../../../../packages/product/src"
import type { BuildIdentity } from "../../../common/types"
import { adapter11818 } from "../index"
import { transformLocale } from "../rules/locales"

const commit = "31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d"
const identity: BuildIdentity = {
  channel: "prod",
  name: "BluedCode",
  appId: "ai.bluedcode.desktop",
  protocol: "bluedcode",
  version: "1.18.18-260816-01-31406ccc51",
  commit,
  shortCommit: commit.slice(0, 10),
  artifactDirectoryName: "BluedCode-1.18.18-260816-01-31406ccc51",
  artifactName: "BluedCode-1.18.18-260816-01-31406ccc51-windows-x64.zip",
  tag: "bluedcode-v1.18.18-260816-01",
}

test("adapter keeps only static locale and renderer resource contracts", () => {
  expect(adapter11818.rules.every((rule) => rule.file === "packages/desktop/src/renderer/index.html")).toBe(true)
  expect(
    adapter11818.modules.find((module) => module.file === "packages/desktop/src/renderer/index.tsx")?.rules,
  ).toEqual([])
  expect(adapter11818.rules.map((rule) => rule.id)).not.toEqual(
    expect.arrayContaining(["renderer-platform-identity", "renderer-window-title", "renderer-notification-icon"]),
  )
})

test("adapter transforms the declared static HTML resources", () => {
  const file = "packages/desktop/src/renderer/index.html"
  const result = adapter11818.transform(file, tracked(file), identity)

  expect(result.code).toContain("<title>BluedCode</title>")
  expect(result.code).toContain('href="./favicon.svg"')
  expect(result.records.length).toBeGreaterThan(0)
})

test("同一 locale AST 字符串中的多个产品关键词以一个语义块记录", () => {
  const result = transformLocale(
    "packages/app/src/i18n/en.ts",
    'export default { "app.name.desktop": "OpenCode OpenCode OpenCode", "settings.desktop.section.wsl": "WSL" }',
    identity,
  )

  expect(result.records).toEqual([
    expect.objectContaining({ id: "locale:brand-name", hits: 3, kind: "semantic-block" }),
  ])
})

test("renderer identity is source-owned and never invokes an upstream service", async () => {
  const source = await readFile(
    new URL("../../../../../../packages/desktop/src/renderer/index.tsx", import.meta.url),
    "utf8",
  )
  expect(source).toContain("desktopVisibleVersion(windowState)")
  expect(source).toContain("getDesktopInitialization")
  expect(source).not.toContain("pkg.version")
  expect(source).not.toContain("opencode.desktop.window")
  expect(source).not.toContain("https://opencode.ai/favicon")
  expect(Product.profile.identity.directoryName).toBe("bluedcode")
})

function tracked(file: string) {
  const result = Bun.spawnSync(["git", "show", `${commit}:${file}`], { cwd: import.meta.dir })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return result.stdout.toString()
}
