import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  captureSourceTree,
  createProductBuildCommands,
  executeProductBuild,
  prepareProductBuild,
  resolveProductBuild,
  verifySourceTreeUnchanged,
} from "../../../script/product-build"

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("product build input", () => {
  test("requires one explicit brand config and rejects legacy inline brand flags", async () => {
    await expect(resolveProductBuild({ args: [], env: {} })).rejects.toThrow("--brand-config")
    await expect(resolveProductBuild({ args: ["--name", "ACMECODE"], env: {} })).rejects.toThrow(
      "Unknown product build option",
    )
  })

  test("loads every identity and visual input from the explicit config", async () => {
    const root = await repository()
    const result = await resolveProductBuild({ root, args: await brandArgs(root), env: {} })

    expect(result.brand.name).toBe("ACMECODE")
    expect(result.brand.slug).toBe("acmecode")
    expect(result.channel).toBe("prod")
    expect(result.brand.channel).toBe("prod")
    expect(result.visuals.appIconSvg).toBe(path.join(root, "fixtures", "app-icon.svg"))
  })

  test("rejects an incomplete visual resource set instead of generating missing brand assets", async () => {
    const root = await repository()
    const target = path.join(root, "incomplete-brand.json")
    await Bun.write(
      target,
      JSON.stringify({
        name: "ACMECODE",
        slug: "acmecode",
        channel: "prod",
        appIconSvg: path.join(root, "fixtures", "app-icon.svg"),
      }),
    )

    await expect(resolveProductBuild({ root, args: ["--brand-config", target], env: {} })).rejects.toThrow(
      "wordmarkSvg",
    )
  })
})

describe("product build staging", () => {
  test("writes expanded files only to an ignored brand-specific staging directory", async () => {
    const root = await repository()
    const args = await brandArgs(root)
    const before = await captureSourceTree(root)
    const result = await prepareProductBuild({
      root,
      args,
      env: {},
    })

    expect(result.stage).toBe(path.join(root, "dist", "product-build", "acmecode", "prod"))
    expect(await Bun.file(path.join(result.stage, "brand.json")).json()).toMatchObject({
      brand: result.brand,
      visuals: { profile: "manifest", sha256: result.visuals.sha256 },
    })
    expect(await Bun.file(path.join(result.stage, "renderer", "index.html")).text()).toContain(
      "<title>ACMECODE</title>",
    )
    const themePreload = await Bun.file(path.join(result.stage, "public", "oc-theme-preload.js")).text()
    expect(themePreload).toContain('var productSlug = "acmecode"')
    expect(themePreload).not.toContain('var productSlug = "foreachcode"')
    expect(await Bun.file(path.join(result.stage, "package.json")).json()).toMatchObject({
      bin: { acmecode: "./bin/opencode" },
    })
    const launcher = await Bun.file(path.join(result.stage, "bin", "opencode")).text()
    expect(launcher).toContain('const productName = "ACMECODE"')
    expect(launcher).toContain('const productCli = "acmecode"')
    expect(launcher).not.toContain("__PRODUCT_")
    expect(await Bun.file(path.join(result.stage, "Dockerfile")).text()).toContain('ENTRYPOINT ["acmecode"]')
    expect(await Bun.file(path.join(result.stage, "resources", "icons", "app-icon.svg")).text()).toContain(
      "<title>ACMECODE application icon</title>",
    )
    await expect(verifySourceTreeUnchanged(root, before)).resolves.toBeUndefined()
  })

  test("detects source changes while preserving pre-existing changes", async () => {
    const root = await repository()
    await Bun.write(path.join(root, "tracked.txt"), "user change")
    const args = await brandArgs(root)
    const before = await captureSourceTree(root)

    await prepareProductBuild({
      root,
      args,
      env: {},
    })
    await expect(verifySourceTreeUnchanged(root, before)).resolves.toBeUndefined()

    await Bun.write(path.join(root, "tracked.txt"), "build change")
    await expect(verifySourceTreeUnchanged(root, before)).rejects.toThrow("modified the source tree")
  })
})

describe("product build orchestration", () => {
  test("uses an explicit local models snapshot without a network fallback", async () => {
    const root = await repository()
    const explicit = path.join(root, "models.json")
    await Bun.write(explicit, '{"explicit":{}}')
    const build = await prepareProductBuild({
      root,
      args: await brandArgs(root),
      env: { MODELS_DEV_API_JSON: explicit },
    })

    expect(build.modelsSnapshot).toBe(explicit)
    expect(createProductBuildCommands(build).every((command) => command.env.MODELS_DEV_API_JSON === explicit)).toBe(
      true,
    )
  })

  test("uses the registered repository snapshot when no explicit snapshot is provided", async () => {
    const root = await repository()
    const build = await prepareProductBuild({
      root,
      args: await brandArgs(root),
      env: {},
    })

    expect(build.modelsSnapshot).toBe(
      path.join(root, "packages", "opencode", "test", "tool", "fixtures", "models-api.json"),
    )
  })

  test("fails before invoking a build when no offline models snapshot exists", async () => {
    const root = await repository()
    await rm(path.join(root, "packages", "opencode", "test", "tool", "fixtures", "models-api.json"))

    await expect(
      prepareProductBuild({
        root,
        args: await brandArgs(root),
        env: {},
      }),
    ).rejects.toThrow("offline models snapshot")
  })

  test("prebuild sends the injected brand and staging resources to metainfo generation", async () => {
    const source = await Bun.file(path.join(import.meta.dir, "prebuild.ts")).text()
    expect(source).toContain("resolveBrandDefinition(process.env.PRODUCT_BRAND_JSON)")
    expect(source).toContain(
      'generateMetainfo(channel, path.join(process.env.PRODUCT_BUILD_STAGE, "resources"), brand)',
    )
  })

  test("passes the compile definition and isolated paths to Desktop build commands", async () => {
    const root = await repository()
    const build = await prepareProductBuild({
      root,
      args: await brandArgs(root),
      env: {},
    })
    const commands = createProductBuildCommands(build)

    expect(commands.map((command) => command.args)).toEqual([
      [process.execPath, "run", "script/build.ts", "--single", "--skip-install", "--skip-embed-web-ui"],
      [process.execPath, "run", "build"],
      [process.execPath, "run", "package", "--", "--dir"],
    ])
    expect(commands[0]?.cwd).toBe(path.join(root, "packages", "opencode"))
    expect(commands.slice(1).every((command) => command.cwd === path.join(root, "packages", "desktop"))).toBe(true)
    expect(commands.every((command) => command.env.PRODUCT_BRAND_JSON === JSON.stringify(build.brand))).toBe(true)
    expect(commands.every((command) => command.env.PRODUCT_VISUAL_JSON === JSON.stringify(build.visualPayload))).toBe(
      true,
    )
    expect(build.visualPayload.appIconSvg).toContain("<svg")
    expect(commands.every((command) => command.env.PRODUCT_BUILD_STAGE === build.stage)).toBe(true)
    expect(commands.every((command) => command.env.OPENCODE_CHANNEL === "prod")).toBe(true)
    expect(build.version).toBe("1.17.9")
    expect(commands.every((command) => command.env.OPENCODE_VERSION === "1.17.9")).toBe(true)
  })

  test("prepare-only creates staging without invoking the build runner", async () => {
    const root = await repository()
    const commands: string[][] = []
    await executeProductBuild(
      {
        root,
        args: [...(await brandArgs(root)), "--prepare-only"],
        env: {},
      },
      async (command) => commands.push(command.args),
    )

    expect(commands).toEqual([])
    expect(await Bun.file(path.join(root, "dist", "product-build", "acmecode", "prod", "brand.json")).exists()).toBe(
      true,
    )
  })

  test("passes explicit visual overrides to the staged visual manifest", async () => {
    const root = await repository()
    const wordmark = path.join(root, "custom-wordmark.svg")
    const icon = path.join(root, "custom-icon.svg")
    const tui = path.join(root, "custom-tui.json")
    await Bun.write(
      wordmark,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 5"><path d="M0 0h20v5H0z"/></svg>',
    )
    await Bun.write(icon, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M0 0h20v20H0z"/></svg>')
    await Bun.write(tui, JSON.stringify({ width: 2, height: 1, cells: [[1, 0]] }))
    const build = await prepareProductBuild({
      root,
      args: await brandArgs(root, { wordmarkSvg: wordmark, appIconSvg: icon, tuiWordmarkGrid: tui }),
      env: {},
    })

    expect(build.visuals.wordmark.path).toBe(wordmark)
    expect(build.visuals.appIcon.path).toBe(path.join(build.stage, "visuals", "app-icon.svg"))
    expect(build.visuals.tuiWordmark.path).toBe(tui)
    const normalizedIcon = await Bun.file(build.visuals.appIcon.path).text()
    expect(normalizedIcon).toContain("<title>ACMECODE application icon</title>")
    expect(await Bun.file(icon).text()).not.toContain("<title>")
    expect(await Bun.file(path.join(build.stage, "resources", "icons", "app-icon.svg")).text()).toBe(normalizedIcon)
    expect(await Bun.file(path.join(build.stage, "public", "app-icon.svg")).text()).toBe(normalizedIcon)
    expect(await Bun.file(path.join(build.stage, "public", "site.webmanifest")).json()).toMatchObject({
      name: "ACMECODE",
      icons: [{ src: "./app-icon.svg", type: "image/svg+xml" }],
    })
    expect(createProductBuildCommands(build)).toHaveLength(3)
  })
})

async function repository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "product-build-test-"))
  temporary.push(root)
  await mkdir(path.join(root, "packages", "desktop", "src", "renderer"), { recursive: true })
  await mkdir(path.join(root, "packages", "opencode", "bin"), { recursive: true })
  await mkdir(path.join(root, "packages", "opencode", "script"), { recursive: true })
  await mkdir(path.join(root, "nix"), { recursive: true })
  await mkdir(path.join(root, "packages", "opencode", "test", "tool", "fixtures"), { recursive: true })
  await mkdir(path.join(root, "packages", "app", "public"), { recursive: true })
  await mkdir(path.join(root, "fixtures"), { recursive: true })
  await Bun.write(path.join(root, ".gitignore"), "dist/\n")
  await Bun.write(path.join(root, "tracked.txt"), "original")
  await Bun.write(
    path.join(root, "packages", "app", "public", "oc-theme-preload.js"),
    ';(function () {\n  // brand:start\n  var productSlug = "foreachcode"\n  // brand:end\n})()\n',
  )
  await Bun.write(
    path.join(root, "fixtures", "app-icon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>',
  )
  await Bun.write(
    path.join(root, "fixtures", "wordmark.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 1"><path d="M0 0h4v1H0z"/></svg>',
  )
  await Bun.write(path.join(root, "fixtures", "tui.json"), JSON.stringify({ width: 2, height: 1, cells: [[1, 0]] }))
  await Bun.write(
    path.join(root, "packages", "desktop", "src", "renderer", "index.html"),
    "<!doctype html><html><head><title>template</title></head><body></body></html>",
  )
  await Bun.write(
    path.join(root, "packages", "opencode", "package.json"),
    JSON.stringify({ name: "@opencode-ai/opencode", version: "1.17.9", bin: { opencode: "./bin/opencode" } }),
  )
  await Bun.write(
    path.join(root, "packages", "opencode", "bin", "opencode"),
    'const productName = "__PRODUCT_NAME__"\nconst productCli = "__PRODUCT_CLI__"\n',
  )
  await Bun.write(
    path.join(root, "packages", "opencode", "script", "postinstall.mjs"),
    'const productSlug = "__PRODUCT_SLUG__"\n',
  )
  await Bun.write(path.join(root, "install"), "APP=__PRODUCT_SLUG__\nPRODUCT_NAME=__PRODUCT_NAME__\n")
  await Bun.write(path.join(root, "packages", "opencode", "Dockerfile"), 'ENTRYPOINT ["__PRODUCT_CLI__"]\n')
  await Bun.write(path.join(root, "nix", "opencode.nix"), 'product = "__PRODUCT_SLUG__";\n')
  await Bun.write(
    path.join(root, "packages", "opencode", "test", "tool", "fixtures", "models-api.json"),
    '{"local":{}}',
  )
  await git(root, "init")
  await git(root, "config", "user.email", "product-build@example.invalid")
  await git(root, "config", "user.name", "Product Build Test")
  await git(root, "add", ".")
  await git(root, "commit", "-m", "test fixture")
  return root
}

async function brandArgs(root: string, override: Record<string, string> = {}) {
  const target = path.join(root, `brand-${crypto.randomUUID()}.json`)
  await Bun.write(
    target,
    JSON.stringify({
      name: "ACMECODE",
      slug: "acmecode",
      channel: "prod",
      appIconSvg: path.join(root, "fixtures", "app-icon.svg"),
      wordmarkSvg: path.join(root, "fixtures", "wordmark.svg"),
      tuiWordmarkGrid: path.join(root, "fixtures", "tui.json"),
      ...override,
    }),
  )
  return ["--brand-config", target]
}

async function git(root: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode === 0) return
  throw new Error(result.stderr.toString())
}
