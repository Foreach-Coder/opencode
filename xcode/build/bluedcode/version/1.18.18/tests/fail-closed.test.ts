import { expect, test } from "bun:test"
import { adapter11818 } from "../index"

test("adapter fails closed for changed static resource inputs without rewriting source-owned runtime modules", () => {
  const file = "packages/desktop/src/renderer/index.html"
  const source = Bun.spawnSync(["git", "show", `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d:${file}`], {
    cwd: import.meta.dir,
  }).stdout.toString()

  expect(() =>
    adapter11818.transform(file, source.replace("<title>OpenCode</title>", "<title>Changed</title>"), {
      channel: "prod",
      name: "BluedCode",
      appId: "ai.bluedcode.desktop",
      protocol: "bluedcode",
      version: "1.18.18-260816-01-31406ccc51",
      commit: "31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d",
      shortCommit: "31406ccc51",
      artifactName: "BluedCode-1.18.18-260816-01-31406ccc51-windows-x64-portable.exe",
      tag: "bluedcode-v1.18.18-260816-01",
    }),
  ).toThrow("指纹")
  expect(adapter11818.modules.find((module) => module.file === "packages/desktop/src/renderer/index.tsx")?.rules).toEqual([])
})
