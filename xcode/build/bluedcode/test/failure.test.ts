import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { collectConfiguredSecrets, readFailureContext, writeFailureReport } from "../common/failure"
import { ensureSafeDirectory, prepareIsolation } from "../common/isolation"
import { createBrandPlugins, createBrandTransformSession } from "../common/plugins"
import type { BuildIdentity } from "../common/types"

test("失败报告记录可审计证据且不泄露 API key 或 Provider 凭据", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bluedcode-failure-"))
  try {
    const file = await writeFailureReport({
      root,
      stage: "renderer",
      code: "BUILD_FAILED",
      error: new Error("provider token=secret-provider-key"),
      gitSha256: "a".repeat(64),
      productProfileSha256: "b".repeat(64),
      frameworkSha256: "c".repeat(64),
      adapterSha256: "d".repeat(64),
      lastModule: "static:desktop:src:renderer:index-html",
      ledgerPath: "stage/ledger/unified-ledger.json",
      symbolBundlePath: "stage/server/node.js.map",
      secrets: ["secret-provider-key", "sk-test-secret"],
    })
    const report = JSON.parse(await readFile(file, "utf8"))
    expect(report).toMatchObject({
      stage: "renderer",
      code: "BUILD_FAILED",
      gitSha256: "a".repeat(64),
      productProfileSha256: "b".repeat(64),
      frameworkSha256: "c".repeat(64),
      adapterSha256: "d".repeat(64),
      lastModule: "static:desktop:src:renderer:index-html",
      ledgerPath: "stage/ledger/unified-ledger.json",
      symbolBundlePath: "stage/server/node.js.map",
    })
    expect(JSON.stringify(report)).not.toContain("secret-provider-key")
    expect(JSON.stringify(report)).not.toContain("sk-test-secret")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("受控 main 转换失败会传播精确上下文并脱敏 MODELS_DEV_API_JSON Provider 凭据", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bluedcode-failure-controlled-"))
  const repositoryRoot = path.join(root, "repository")
  const outputRoot = path.join(repositoryRoot, ".xcode", "bluedcode")
  const ledgerRoot = path.join(outputRoot, "ledger", "electron")
  const providerSecret = "models-provider-secret"
  try {
    await mkdir(repositoryRoot, { recursive: true })
    const isolation = await prepareIsolation({ repositoryRoot, outputRoot })
    await ensureSafeDirectory(isolation, ledgerRoot)
    const identity: BuildIdentity = {
      channel: "dev",
      name: "BluedCode Dev",
      appId: "ai.bluedcode.desktop.dev",
      protocol: "bluedcode-dev",
      version: "1.18.18-dev-0123456789",
      commit: "0123456789abcdef0123456789abcdef01234567",
      shortCommit: "0123456789",
      artifactDirectoryName: "BluedCode-Dev-1.18.18-dev-0123456789",
      artifactName: "BluedCode-Dev.exe",
    }
    const plugins = createBrandPlugins({
      adapter: {
        modules: [
          {
            id: "main:controlled",
            file: "packages/main.ts",
            stage: "main",
            fingerprint: "a".repeat(64),
            rules: [],
          },
        ],
        fingerprints: { "packages/main.ts": "a".repeat(64) },
        transform() {
          throw new Error(`provider credential=${providerSecret}`)
        },
      },
      identity,
      isolation,
      ledgerRoot,
      repositoryRoot,
      requiredBuildTargets: ["packages/main.ts"],
      session: createBrandTransformSession(["main"]),
      target: "main",
    })
    const plugin = plugins.find((item) => item && typeof item === "object" && item.name === "bluedcode:transform")
    if (!plugin || typeof plugin !== "object" || typeof plugin.transform !== "function")
      throw new Error("缺少 transform plugin")
    let failure: unknown
    try {
      await plugin.transform.call({}, "export {}", path.join(repositoryRoot, "packages", "main.ts"))
    } catch (error) {
      failure = error
    }
    const context = readFailureContext(failure)
    expect(context).toEqual({
      stage: "main",
      code: "CONTROLLED_TRANSFORM_FAILED",
      lastModule: "main:controlled",
      ledgerPath: null,
      symbolBundlePath: null,
    })
    const file = await writeFailureReport({
      root: outputRoot,
      ...context!,
      error: failure,
      gitSha256: "a".repeat(64),
      productProfileSha256: "b".repeat(64),
      frameworkSha256: "c".repeat(64),
      adapterSha256: "d".repeat(64),
      secrets: collectConfiguredSecrets([
        { MODELS_DEV_API_JSON: JSON.stringify({ providers: [{ apiKey: providerSecret }] }) },
      ]),
    })
    const report = await readFile(file, "utf8")
    expect(report).toContain('"stage": "main"')
    expect(report).toContain('"lastModule": "main:controlled"')
    expect(report).not.toContain(providerSecret)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
