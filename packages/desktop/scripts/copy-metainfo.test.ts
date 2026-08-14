import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { Brand, resolveBrand } from "@opencode-ai/brand"
import { generateMetainfo } from "./copy-metainfo"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("desktop metainfo", () => {
  test("removes stale product identities before generating the current channel", async () => {
    const root = path.join(import.meta.dir, `.tmp-${crypto.randomUUID()}`)
    roots.push(root)
    await mkdir(root, { recursive: true })
    await Bun.write(path.join(root, "ai.foreachcode.desktop.metainfo.xml"), "stale")
    await Bun.write(path.join(root, "keep.txt"), "keep")

    const target = await generateMetainfo("prod", root, Brand)
    const metainfo = Array.from(new Bun.Glob("*.metainfo.xml").scanSync({ cwd: root })).toSorted()

    expect(metainfo).toEqual([`${Brand.desktop.prod.appId}.metainfo.xml`])
    expect(await Bun.file(target).text()).toContain(`<name>${Brand.name}</name>`)
    expect(await Bun.file(path.join(root, "keep.txt")).text()).toBe("keep")
  })

  test("generates metadata only from the supplied build brand", async () => {
    const directory = path.join(import.meta.dir, `.tmp-${crypto.randomUUID()}`)
    roots.push(directory)
    await mkdir(directory, { recursive: true })
    const brand = resolveBrand({
      cli: { name: "FKGCODE", slug: "fkgcode", channel: "prod", enterprise: true },
    })

    const target = await generateMetainfo("prod", directory, brand)
    const content = await Bun.file(target).text()

    expect(path.basename(target)).toBe("ai.fkgcode.desktop.metainfo.xml")
    expect(content).toContain("<name>FKGCODE</name>")
    expect(content).toContain("<id>ai.fkgcode.desktop</id>")
    expect(content).not.toContain(Brand.name)
  })
})

test("generates valid XML for a readable product identity", async () => {
  const root = path.join(import.meta.dir, `.tmp-${crypto.randomUUID()}`)
  roots.push(root)
  await mkdir(root, { recursive: true })
  const brand = resolveBrand({
    cli: { name: "企业代码", slug: "enterprise-code", channel: "prod", enterprise: true },
  })
  const target = await generateMetainfo("prod", root, brand)
  expect(await Bun.file(target).text()).toContain("<name>企业代码</name>")
})
