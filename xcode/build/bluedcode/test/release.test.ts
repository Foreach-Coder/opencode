import { describe, expect, test } from "bun:test"
import { createAnnotatedTagCommand, refreshReleaseLedger, validateReleaseSequence } from "../common/release"
import type { Git } from "../common/git"

describe("validateReleaseSequence", () => {
  test("同日序号跨 OpenCode 小版本全局递增", () => {
    expect(() => validateReleaseSequence(["bluedcode-v1.18.17-260815-01"], "260815-01")).toThrow("应为 02")
    expect(() =>
      validateReleaseSequence(["bluedcode-v1.17.9-260815-01", "bluedcode-v1.18.17-260815-02"], "260815-03"),
    ).not.toThrow()
  })

  test("新日期从 01 开始并拒绝跳号、回退与重复", () => {
    expect(() => validateReleaseSequence([], "260815-01")).not.toThrow()
    expect(() => validateReleaseSequence(["bluedcode-v1.18.18-260814-01"], "260815-01")).not.toThrow()
    expect(() => validateReleaseSequence([], "260815-02")).toThrow("应为 01")
    expect(() => validateReleaseSequence(["bluedcode-v1.18.18-260815-01"], "260815-01")).toThrow("应为 02")
    expect(() => validateReleaseSequence(["bluedcode-v1.18.18-260816-01"], "260815-01")).toThrow("不得早于")
  })

  test("只把完整 BluedCode 正式 tag 计入账本", () => {
    expect(() =>
      validateReleaseSequence(["v1.18.18", "bluedcode-v1.18.18-beta-260815-99", "other-v1.0.0-260815-41"], "260815-01"),
    ).not.toThrow()
  })

  test("历史账本拒绝 00、跨版本重复与任意日期断号", () => {
    expect(() => validateReleaseSequence(["bluedcode-v1.18.18-260815-00"], "260815-01")).toThrow(/00|01/)
    expect(() =>
      validateReleaseSequence(["bluedcode-v1.18.17-260815-01", "bluedcode-v1.18.18-260815-01"], "260815-02"),
    ).toThrow(/重复|唯一/)
    expect(() =>
      validateReleaseSequence(["bluedcode-v1.18.18-260814-01", "bluedcode-v1.18.17-260814-03"], "260815-01"),
    ).toThrow(/连续|缺少.*02|断号/)
  })

  test("历史账本允许同日跨版本从 01 全局连续", () => {
    expect(() =>
      validateReleaseSequence(
        [
          "bluedcode-v1.18.16-260814-01",
          "bluedcode-v1.18.17-260814-02",
          "bluedcode-v1.18.18-260815-01",
          "bluedcode-v1.17.9-260815-02",
        ],
        "260815-03",
      ),
    ).not.toThrow()
  })
})

test("正式预检先 fetch tags，再读取全局账本并返回全部候选", async () => {
  const calls: string[][] = []
  const git: Git = {
    async run(args) {
      calls.push([...args])
      if (args[0] === "fetch") return { exitCode: 0, stdout: "", stderr: "" }
      return {
        exitCode: 0,
        stdout: "bluedcode-v1.18.17-260815-01\nbluedcode-v1.18.18-260814-01\n",
        stderr: "",
      }
    },
  }

  expect(await refreshReleaseLedger(git, "260815-02")).toEqual([
    "bluedcode-v1.18.17-260815-01",
    "bluedcode-v1.18.18-260814-01",
  ])
  expect(calls).toEqual([
    ["fetch", "--tags"],
    ["tag", "--list", "bluedcode-v*"],
  ])
})

test("发行账本 Git 失败时在构建重活前 fail closed", async () => {
  const git: Git = {
    async run() {
      return { exitCode: 1, stdout: "", stderr: "network denied" }
    },
  }

  const failure = await refreshReleaseLedger(git, "260815-01").then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(failure).toBeInstanceOf(Error)
  expect(String(failure)).toContain("network denied")
})

test("annotated tag 命令只作为含中文摘要的候选输出", () => {
  expect(
    createAnnotatedTagCommand({
      artifactName: "BluedCode-1.18.18-260815-01-0123456789-windows-x64.zip",
      artifactSha256: "a".repeat(64),
      commit: "0123456789abcdef0123456789abcdef01234567",
      tag: "bluedcode-v1.18.18-260815-01",
      version: "1.18.18-260815-01-0123456789",
    }),
  ).toBe(
    `git tag -a bluedcode-v1.18.18-260815-01 0123456789abcdef0123456789abcdef01234567 -m "发布 BluedCode 1.18.18-260815-01-0123456789 Windows x64 zip 目录包；产物 BluedCode-1.18.18-260815-01-0123456789-windows-x64.zip；SHA-256 ${"a".repeat(64)}"`,
  )
})
