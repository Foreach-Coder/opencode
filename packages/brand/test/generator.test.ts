import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { Brand } from "../src"
import {
  checkBrandTargets,
  checkStaticBrandTargets,
  generateBrandTargets,
  generateStaticBrandTargets,
  staticTargetPaths,
  targetPaths,
} from "../../../script/brand"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = path.join(import.meta.dir, `.tmp-${crypto.randomUUID()}`)
  roots.push(root)
  await mkdir(root, { recursive: true })
  return root
}

describe("brand generator", () => {
  test("only writes the declared target whitelist", async () => {
    const root = await fixture()
    await generateBrandTargets(root)

    expect(
      Array.from(new Bun.Glob("**/*").scanSync({ cwd: root, onlyFiles: true }))
        .map((item) => item.replaceAll("\\", "/"))
        .toSorted(),
    ).toEqual(targetPaths.toSorted())
    expect(await checkBrandTargets(root)).toEqual([])
  })

  test("reports missing and stale generated targets without changing them", async () => {
    const root = await fixture()
    await generateBrandTargets(root)
    await Bun.write(path.join(root, targetPaths[0]!), "stale\n")
    await Bun.file(path.join(root, targetPaths[1]!)).delete()

    expect(await checkBrandTargets(root)).toEqual([targetPaths[0], targetPaths[1]])
    expect(await Bun.file(path.join(root, targetPaths[0]!)).text()).toBe("stale\n")
  })

  test("updates only declared fields in static brand targets", async () => {
    const root = await fixture()
    await mkdir(path.join(root, "packages/opencode"), { recursive: true })
    await mkdir(path.join(root, "packages/opencode/bin"), { recursive: true })
    await mkdir(path.join(root, "packages/opencode/script"), { recursive: true })
    await mkdir(path.join(root, "nix"), { recursive: true })
    await mkdir(path.join(root, "packages/app"), { recursive: true })
    await mkdir(path.join(root, "packages/app/public"), { recursive: true })
    await mkdir(path.join(root, "packages/desktop/src/renderer"), { recursive: true })
    await mkdir(path.join(root, "packages/ui/src/assets/favicon"), { recursive: true })
    await mkdir(path.join(root, "packages/ui/src/theme/themes"), { recursive: true })
    await Bun.write(path.join(root, "install"), "before\n# brand:start\nold\n# brand:end\nafter\n")
    await Bun.write(
      path.join(root, "packages/opencode/package.json"),
      `${JSON.stringify({ name: "opencode", bin: { old: "./bin/old" } }, null, 2)}\n`,
    )
    await Bun.write(
      path.join(root, "packages/opencode/bin/opencode"),
      "before\n// brand:start\nold\n// brand:end\nafter\n",
    )
    await Bun.write(
      path.join(root, "packages/opencode/script/postinstall.mjs"),
      "before\n// brand:start\nold\n// brand:end\nafter\n",
    )
    await Bun.write(path.join(root, "packages/opencode/Dockerfile"), "# brand:start\nold\n# brand:end\n")
    await Bun.write(path.join(root, "nix/opencode.nix"), "  # brand:start\n  old\n  # brand:end\n")
    await Bun.write(path.join(root, "packages/desktop/package.json"), `${JSON.stringify({ author: {} }, null, 2)}\n`)
    await Bun.write(path.join(root, "packages/desktop/src/renderer/index.html"), "<title>Old</title>\n")
    await Bun.write(path.join(root, "packages/app/index.html"), "<title>Old App</title>\n")
    await Bun.write(
      path.join(root, "packages/app/public/oc-theme-preload.js"),
      '// brand:start\nvar productSlug = "old"\n// brand:end\nvar key = productSlug + "-theme-id"\n',
    )
    await Bun.write(
      path.join(root, "packages/ui/src/assets/favicon/favicon.svg"),
      '<svg><title id="title">Old application icon</title></svg>\n',
    )
    await Bun.write(
      path.join(root, "packages/ui/src/assets/favicon/favicon-v3.svg"),
      '<svg><title id="title">Old application icon</title></svg>\n',
    )
    await Bun.write(
      path.join(root, "packages/ui/src/assets/favicon/site.webmanifest"),
      `${JSON.stringify({ name: "Old", short_name: "Old", display: "standalone" }, null, 2)}\n`,
    )
    await Bun.write(
      path.join(root, "packages/ui/src/theme/desktop-theme.schema.json"),
      `${JSON.stringify({ title: "Old Theme", description: "Old description", type: "object" }, null, 2)}\n`,
    )
    await Bun.write(
      path.join(root, "packages/ui/src/theme/themes/opencode.json"),
      `${JSON.stringify({ name: "Old", defs: {} }, null, 2)}\n`,
    )

    expect(staticTargetPaths).toHaveLength(15)
    await generateStaticBrandTargets(root)
    expect(await checkStaticBrandTargets(root)).toEqual([])
    expect(await Bun.file(path.join(root, "install")).text()).toContain(`APP=${Brand.slug}\nPRODUCT_NAME=${Brand.name}`)
    expect(await Bun.file(path.join(root, "packages/opencode/package.json")).json()).toMatchObject({
      name: "opencode",
      bin: { [Brand.cli]: "./bin/opencode" },
    })
    expect(await Bun.file(path.join(root, "packages/ui/src/theme/desktop-theme.schema.json")).json()).toMatchObject({
      title: `${Brand.name} Desktop Theme`,
      description: `A theme definition for the ${Brand.name} desktop application`,
      type: "object",
    })
    expect(await Bun.file(path.join(root, "packages/ui/src/theme/themes/opencode.json")).json()).toMatchObject({
      name: Brand.name,
      defs: {},
    })
    expect(await Bun.file(path.join(root, "packages/app/index.html")).text()).toContain(`<title>${Brand.name}</title>`)
    expect(await Bun.file(path.join(root, "packages/opencode/bin/opencode")).text()).toContain(
      `const productDirectory = ${JSON.stringify(Brand.directory)}`,
    )
    expect(await Bun.file(path.join(root, "packages/opencode/bin/opencode")).text()).toContain(
      `const productCli = ${JSON.stringify(Brand.cli)}`,
    )
    expect(await Bun.file(path.join(root, "packages/opencode/script/postinstall.mjs")).text()).toContain(
      `const productCli = ${JSON.stringify(Brand.cli)}`,
    )
    expect(await Bun.file(path.join(root, "packages/app/public/oc-theme-preload.js")).text()).toContain(
      `var productSlug = ${JSON.stringify(Brand.slug)}`,
    )
    expect(await Bun.file(path.join(root, "packages/ui/src/assets/favicon/favicon.svg")).text()).toContain(
      `${Brand.name} application icon`,
    )
    expect(await Bun.file(path.join(root, "packages/ui/src/assets/favicon/favicon-v3.svg")).text()).toContain(
      `${Brand.name} application icon`,
    )
    expect(await Bun.file(path.join(root, "packages/opencode/Dockerfile")).text()).toContain(
      `dist/${Brand.slug}-linux-x64-baseline-musl/bin/${Brand.cli}`,
    )
    expect(await Bun.file(path.join(root, "nix/opencode.nix")).text()).toContain(
      `product = ${JSON.stringify(Brand.slug)}`,
    )
  })
})
