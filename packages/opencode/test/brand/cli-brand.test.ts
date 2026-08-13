import { describe, expect, test } from "bun:test"
import path from "path"
import os from "os"
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises"
import { Brand } from "@opencode-ai/brand"

const root = path.resolve(import.meta.dir, "../../../..")

describe("product CLI identity", () => {
  test("publishes only the product command", async () => {
    const pkg = await Bun.file(path.join(root, "packages/opencode/package.json")).json()

    expect(pkg.name).toBe("opencode")
    expect(Object.keys(pkg.bin)).toEqual([Brand.cli])
    expect(await Bun.file(path.join(root, "packages/opencode", pkg.bin[Brand.cli])).exists()).toBeTrue()
  })

  test("runs the package launcher in a real ESM npm layout", async () => {
    const node = Bun.which("node")
    expect(node).toBeTruthy()

    const directory = await mkdtemp(path.join(os.tmpdir(), `${Brand.slug}-launcher-`))
    const packageDirectory = path.join(directory, "node_modules", "opencode")
    const platform = process.platform === "win32" ? "windows" : process.platform
    const binary = process.platform === "win32" ? `${Brand.cli}.exe` : Brand.cli
    const targets = [`${Brand.slug}-${platform}-${process.arch}`, `${Brand.slug}-${platform}-${process.arch}-baseline`]

    try {
      await mkdir(path.join(packageDirectory, "bin"), { recursive: true })
      await Bun.write(path.join(packageDirectory, "package.json"), JSON.stringify({ type: "module" }))
      await Bun.write(
        path.join(packageDirectory, "bin", "opencode"),
        Bun.file(path.join(root, "packages/opencode/bin/opencode")),
      )
      await Promise.all(
        targets.map(async (target) => {
          const targetDirectory = path.join(directory, "node_modules", target, "bin")
          await mkdir(targetDirectory, { recursive: true })
          await copyFile(node!, path.join(targetDirectory, binary))
        }),
      )

      const result = Bun.spawnSync([node!, path.join(packageDirectory, "bin", "opencode"), "--version"], {
        cwd: directory,
        env: { ...process.env, OPENCODE_BIN_PATH: undefined },
        stdout: "pipe",
        stderr: "pipe",
      })

      expect(result.exitCode).toBe(0)
      expect(result.stderr.toString()).toBe("")
      expect(result.stdout.toString().trim()).toMatch(/^v\d+/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("uses the product command in generated help", async () => {
    const source = await Bun.file(path.join(root, "packages/opencode/src/index.ts")).text()

    expect(source).toContain(".scriptName(Brand.cli)")
    expect(source).not.toContain('.scriptName("opencode")')
  })

  test("builds and smoke-tests the product executable", async () => {
    const source = await Bun.file(path.join(root, "packages/opencode/script/build.ts")).text()

    expect(source).toContain('import { Brand } from "@opencode-ai/brand"')
    expect(source).toContain("bin/${Brand.cli}")
    expect(source).not.toContain("bin/opencode")
  })

  test("installs only into the product home directory", async () => {
    const source = await Bun.file(path.join(root, "install")).text()

    expect(source).toContain(`APP=${Brand.slug}`)
    expect(source).toContain('INSTALL_DIR="$HOME/.$APP/bin"')
    expect(source).toContain("${INSTALL_DIR}/${APP}")
    expect(source).not.toContain("$HOME/.opencode/bin")
    expect(source).not.toContain("${INSTALL_DIR}/opencode")
    expect(source).not.toContain("https://opencode.ai/install")
    expect(source).not.toContain("github.com/anomalyco/opencode/releases")
    expect(source).toContain("$PRODUCT_NAME remote install source is not configured")
  })

  test("uninstall removes only the product shell entry", async () => {
    const source = await Bun.file(path.join(root, "packages/opencode/src/cli/cmd/uninstall.ts")).text()

    expect(source).toContain('import { Brand } from "@opencode-ai/brand"')
    expect(source).toContain("`# ${Brand.slug}`")
    expect(source).toContain("`.${Brand.directory}/bin`")
    expect(source).not.toContain("# opencode")
    expect(source).not.toContain(".opencode/bin")
    expect(source).not.toContain('"brew", "uninstall", "opencode"')
  })

  test("does not contact upstream update services from startup or the upgrade command", async () => {
    const startup = await Bun.file(path.join(root, "packages/opencode/src/cli/upgrade.ts")).text()
    const command = await Bun.file(path.join(root, "packages/opencode/src/cli/cmd/upgrade.ts")).text()
    const handler = await Bun.file(
      path.join(root, "packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts"),
    ).text()
    const index = await Bun.file(path.join(root, "packages/opencode/src/index.ts")).text()

    expect(startup).not.toContain("Installation.latest")
    expect(startup).not.toContain("Installation.upgrade")
    expect(command).not.toContain("Installation.latest")
    expect(command).not.toContain("Installation.upgrade")
    expect(command).toContain("internal update source is not configured")
    expect(command).toContain("process.exitCode = 1")
    expect(index).not.toContain("UpgradeCommand")
    expect(handler).not.toContain("installation.latest")
    expect(handler).not.toContain("installation.upgrade")
  })

  test("keeps the SDK server launcher aligned with the product command", async () => {
    const current = await Bun.file(path.join(root, "packages/sdk/js/src/server.ts")).text()
    const v2 = await Bun.file(path.join(root, "packages/sdk/js/src/v2/server.ts")).text()

    expect(current).toContain('from "./brand.gen.js"')
    expect(v2).toContain('from "../brand.gen.js"')
    expect(current).not.toContain("launch(`opencode`")
    expect(v2).not.toContain("launch(`opencode`")
  })

  test("keeps npm postinstall aligned with product platform packages", async () => {
    const source = await Bun.file(path.join(root, "packages/opencode/script/postinstall.mjs")).text()

    expect(source).toContain("// brand:start")
    expect(source).toContain(`const productSlug = ${JSON.stringify(Brand.slug)}`)
    expect(source).toContain(`const productCli = ${JSON.stringify(Brand.cli)}`)
    expect(source).not.toContain("`opencode-${platform}-${arch}`")
    expect(source).not.toContain('sourceBinary = platform === "windows" ? "opencode.exe" : "opencode"')
  })

  test("injects the product version into the packaged node server", async () => {
    const source = await Bun.file(path.join(root, "packages/opencode/script/build-node.ts")).text()

    expect(source).toContain("OPENCODE_VERSION: `'${Script.version}'`")
  })

  test("fails closed before any release upload can run", async () => {
    const build = await Bun.file(path.join(root, "packages/opencode/script/build.ts")).text()
    const workflow = await Bun.file(path.join(root, ".github/workflows/publish.yml")).text()

    expect(build).not.toContain("gh release upload")
    expect(workflow).not.toContain("gh release upload")
    expect(workflow).not.toContain("push:")
    expect(workflow).toContain("workflow_dispatch:")
    expect(workflow).toContain("exit 1")
  })
})
