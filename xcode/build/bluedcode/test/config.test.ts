import { describe, expect, test } from "bun:test"
import {
  assertGitSourceUnchanged,
  assertTrackedBaseline,
  captureGitSourceState,
  parseBuildArgs,
  recertifyGitSource,
  resolveBuildIdentity,
  withCertifiedGitSource,
} from "../common/config"
import type { Git, GitResult } from "../common/git"
import { baseline } from "../version/1.18.18/baseline"

const commit = "0123456789abcdef0123456789abcdef01234567"

function gitFixture(overrides: Partial<Record<string, GitResult>> = {}): Git {
  return {
    async run(args) {
      const key = args.join(" ")
      return (
        overrides[key] ?? {
          exitCode: 0,
          stdout:
            key === "rev-parse HEAD"
              ? `${commit}\n`
              : key === "rev-parse --short=10 HEAD"
                ? `${commit.slice(0, 10)}\n`
                : key === "show HEAD:packages/desktop/package.json"
                  ? '{"version":"1.18.18"}\n'
                  : "",
          stderr: "",
        }
      )
    },
  }
}

describe("parseBuildArgs", () => {
  test("prod 必须显式给出 YYMMDD-NN", () => {
    expect(() => parseBuildArgs(["--channel", "prod"])).toThrow("--release")
    expect(parseBuildArgs(["--channel", "prod", "--release", "260815-01"])).toEqual({
      channel: "prod",
      release: "260815-01",
    })
  })

  test("拒绝 beta、非 Windows x64 和伪造 commit", () => {
    expect(() => parseBuildArgs(["--channel", "beta"])).toThrow("dev 或 prod")
    expect(() => parseBuildArgs(["--channel", "dev", "--platform", "linux"])).toThrow("未知参数")
    expect(() => parseBuildArgs(["--channel", "dev", "--arch", "arm64"])).toThrow("未知参数")
    expect(() => parseBuildArgs(["--channel", "dev", "--commit", "deadbeef"])).toThrow("未知参数")
  })

  test("拒绝缺少 channel、dev release 和无效发行日期", () => {
    expect(() => parseBuildArgs([])).toThrow("--channel")
    expect(() => parseBuildArgs(["--channel", "dev", "--release", "260815-01"])).toThrow("仅适用于 prod")
    expect(() => parseBuildArgs(["--channel", "prod", "--release", "260230-01"])).toThrow("YYMMDD-NN")
    expect(() => parseBuildArgs(["--channel", "prod", "--release", "260815-00"])).toThrow("YYMMDD-NN")
  })

  test("audit-only 是无需 release 的兼容审计参数", () => {
    expect(parseBuildArgs(["--channel", "dev", "--audit-only"])).toEqual({ channel: "dev", auditOnly: true })
    expect(() => parseBuildArgs(["--channel", "prod", "--release", "260815-01", "--audit-only"])).toThrow(
      "audit-only",
    )
  })
})

describe("resolveBuildIdentity", () => {
  test("派生 dev 身份、版本和 Portable 文件名", async () => {
    await expect(resolveBuildIdentity({ channel: "dev" }, gitFixture(), baseline)).resolves.toEqual({
      channel: "dev",
      name: "BluedCode Dev",
      appId: "ai.bluedcode.desktop.dev",
      protocol: "bluedcode-dev",
      version: "1.18.18-dev-0123456789",
      commit,
      shortCommit: "0123456789",
      artifactName: "BluedCode-Dev-1.18.18-dev-0123456789-windows-x64-portable.exe",
    })
  })

  test("派生 prod 身份、发行 tag 和 Portable 文件名", async () => {
    await expect(
      resolveBuildIdentity({ channel: "prod", release: "260815-01" }, gitFixture(), baseline),
    ).resolves.toEqual({
      channel: "prod",
      name: "BluedCode",
      appId: "ai.bluedcode.desktop",
      protocol: "bluedcode",
      version: "1.18.18-260815-01-0123456789",
      commit,
      shortCommit: "0123456789",
      artifactName: "BluedCode-1.18.18-260815-01-0123456789-windows-x64-portable.exe",
      tag: "bluedcode-v1.18.18-260815-01",
    })
  })

  test("拒绝非 10 位短 commit 与非十六进制完整 commit", async () => {
    const shortCommitGit = gitFixture({
      "rev-parse --short=10 HEAD": { exitCode: 0, stdout: "012345678\n", stderr: "" },
    })
    await expect(resolveBuildIdentity({ channel: "dev" }, shortCommitGit, baseline)).rejects.toThrow("10 位")

    const forgedCommitGit = gitFixture({
      "rev-parse HEAD": { exitCode: 0, stdout: "z123456789abcdef0123456789abcdef01234567\n", stderr: "" },
    })
    await expect(resolveBuildIdentity({ channel: "dev" }, forgedCommitGit, baseline)).rejects.toThrow("Git commit")
  })

  test("拒绝与受信 1.18.18 基线不匹配的 Desktop 版本", async () => {
    const upgradedDesktop = gitFixture({
      "show HEAD:packages/desktop/package.json": { exitCode: 0, stdout: '{"version":"1.19.0"}\n', stderr: "" },
    })
    await expect(resolveBuildIdentity({ channel: "dev" }, upgradedDesktop, baseline)).rejects.toThrow("1.18.18")
  })
})

describe("assertTrackedBaseline", () => {
  test("只允许 untracked 的 BluedCode owned output，不让缓存污染下一次预检", async () => {
    const owned = gitFixture({
      "status --porcelain=v1 -z --untracked-files=all": {
        exitCode: 0,
        stdout:
          "?? .xcode/bluedcode/cache/server/result.json\0?? .xcode/bluedcode/workspaces/dev/out/BluedCode Dev.exe\0",
        stderr: "",
      },
    })

    await expect(assertTrackedBaseline(owned)).resolves.toBeUndefined()
  })

  test("拒绝其他 .xcode、相似前缀与 owned 路径中的 tracked 修改", async () => {
    for (const status of [
      "?? .xcode/other/file.json\0",
      "?? .xcode/bluedcode-evil/file.json\0",
      " M .xcode/bluedcode/cache/server/result.json\0",
    ]) {
      const git = gitFixture({
        "status --porcelain=v1 -z --untracked-files=all": { exitCode: 0, stdout: status, stderr: "" },
      })
      await expect(assertTrackedBaseline(git)).rejects.toThrow("Git 工作区不干净")
    }
  })

  test("接受干净工作区", async () => {
    await expect(assertTrackedBaseline(gitFixture())).resolves.toBeUndefined()
  })

  test("拒绝 tracked 与 untracked 变更", async () => {
    const tracked = gitFixture({
      "status --porcelain=v1 -z --untracked-files=all": {
        exitCode: 0,
        stdout: " M packages/desktop/src/main/index.ts\0",
        stderr: "",
      },
    })
    await expect(assertTrackedBaseline(tracked)).rejects.toThrow("Git 工作区不干净")

    const untracked = gitFixture({
      "status --porcelain=v1 -z --untracked-files=all": { exitCode: 0, stdout: "?? local-input.txt\0", stderr: "" },
    })
    await expect(assertTrackedBaseline(untracked)).rejects.toThrow("Git 工作区不干净")
  })

  test("prod baseline 只认证 tracked 状态，不因为 ignored overlay 拒绝本地构建缓存", async () => {
    const calls: string[] = []
    const overlay: Git = {
      async run(args) {
        const command = args.join(" ")
        calls.push(command)
        if (command === "status --porcelain=v1 -z --untracked-files=all") return gitResult("")
        if (command.startsWith("ls-files --others --ignored")) {
          return { exitCode: 0, stdout: "packages/brand/\npackages/web/node_modules/\n", stderr: "" }
        }
        return gitResult("")
      },
    }

    expect(await assertTrackedBaseline(overlay)).toBeUndefined()
    expect(calls.some((call) => call.startsWith("ls-files --others --ignored"))).toBe(false)
  })
})

describe("Git source certification", () => {
  const sourceState = {
    branch: "task-7",
    head: commit,
    trackedContentSha256: "b".repeat(64),
    trackedIndexSha256: "a".repeat(64),
  }

  test("记录 HEAD、branch、tracked index/content digest", async () => {
    const git = gitFixture({
      "rev-parse --abbrev-ref HEAD": { exitCode: 0, stdout: "task-7\n", stderr: "" },
      "ls-files --stage -z": { exitCode: 0, stdout: "100644 abc 0\ttracked.ts\0", stderr: "" },
      [`ls-tree -r -z --full-tree ${commit}`]: {
        exitCode: 0,
        stdout: "100644 blob abc\ttracked.ts\0",
        stderr: "",
      },
    })

    expect(await captureGitSourceState(git)).toEqual({
      branch: "task-7",
      head: commit,
      trackedContentSha256: "8867d0a7e8325c0c09be31ca3d096f82f8662efc299dbb1d9a2059326a5a8aaa",
      trackedIndexSha256: "f8ffe10ed0c74df8948e23ff6bb67a40e0395a2fd4515dbc606d2506721725b6",
    })
  })

  test("tracked source capture 不查询或消费未参与依赖图的 ignored overlay", async () => {
    const calls: string[] = []
    const git: Git = {
      async run(args) {
        const command = args.join(" ")
        calls.push(command)
        if (command === "status --porcelain=v1 -z --untracked-files=all") return gitResult("")
        if (command === "rev-parse HEAD") return gitResult(`${commit}\n`)
        if (command === "rev-parse --abbrev-ref HEAD") return gitResult("task-7\n")
        if (command === "ls-files --stage -z") return gitResult("100644 abc 0\ttracked.ts\0")
        if (command === `ls-tree -r -z --full-tree ${commit}`) return gitResult("100644 blob abc\ttracked.ts\0")
        return { exitCode: 1, stdout: "", stderr: `ignored overlay query must not run: ${command}` }
      },
    }

    expect(await captureGitSourceState(git)).toMatchObject({ head: commit, branch: "task-7" })
    expect(calls.some((call) => call.startsWith("ls-files --others --ignored"))).toBe(false)
  })

  test("构建后 HEAD、tracked digest 或 dirty 任一变化都拒绝认证", async () => {
    expect(() => assertGitSourceUnchanged(sourceState, { ...sourceState, head: "f".repeat(40) })).toThrow("HEAD")
    expect(() =>
      assertGitSourceUnchanged(sourceState, { ...sourceState, trackedContentSha256: "c".repeat(64) }),
    ).toThrow(/content|内容/)

    const dirty = gitFixture({
      "status --porcelain=v1 -z --untracked-files=all": {
        exitCode: 0,
        stdout: " M tracked.ts\0",
        stderr: "",
      },
    })
    await expectFailure(captureGitSourceState(dirty), /不干净/)
  })

  test("注入 Git fixture 时 post-build recertification 拒绝 checkout、tracked 改写与 dirty", async () => {
    for (const changed of ["head", "index", "content", "dirty"] as const) {
      const git = sourceSequenceGit(changed)
      const before = await captureGitSourceState(git)
      await expectFailure(recertifyGitSource(git, before), /HEAD|index|content|内容|不干净/)
    }
  })

  test("post-build 认证失败时不进入 manifest/publish 回调", async () => {
    for (const changed of ["head", "index", "content", "dirty"] as const) {
      const git = sourceSequenceGit(changed)
      const before = await captureGitSourceState(git)
      let published = false
      await expectFailure(
        withCertifiedGitSource(git, before, async () => {
          published = true
        }),
        /HEAD|index|content|内容|不干净/,
      )
      expect(published).toBe(false)
    }
  })
})

function sourceSequenceGit(changed: "head" | "index" | "content" | "dirty"): Git {
  const calls = new Map<string, number>()
  return {
    async run(args) {
      const command = args.join(" ")
      const call = calls.get(command) ?? 0
      calls.set(command, call + 1)
      if (command === "status --porcelain=v1 -z --untracked-files=all") {
        return gitResult(changed === "dirty" && call >= 2 ? " M tracked.ts\0" : "")
      }
      if (command.startsWith("ls-files --others --ignored")) return gitResult("")
      if (command === "rev-parse HEAD")
        return gitResult(changed === "head" && call >= 2 ? `${"f".repeat(40)}\n` : `${commit}\n`)
      if (command === "rev-parse --abbrev-ref HEAD") return gitResult("task-7\n")
      if (command === "ls-files --stage -z") {
        return gitResult(
          changed === "index" && call === 1 ? "100644 def 0\ttracked.ts\0" : "100644 abc 0\ttracked.ts\0",
        )
      }
      if (command.startsWith("ls-tree -r -z --full-tree ")) {
        return gitResult(
          changed === "content" && call === 1 ? "100644 blob def\ttracked.ts\0" : "100644 blob abc\ttracked.ts\0",
        )
      }
      return { exitCode: 1, stdout: "", stderr: `unexpected command: ${command}` }
    },
  }
}

function gitResult(stdout: string) {
  return { exitCode: 0, stdout, stderr: "" }
}

async function expectFailure(promise: Promise<unknown>, pattern: RegExp) {
  const failure = await promise.then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(failure).toBeInstanceOf(Error)
  expect(String(failure)).toMatch(pattern)
}
