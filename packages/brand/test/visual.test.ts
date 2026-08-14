import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { resolveVisuals, type VisualProfileRegistry } from "../src/visual"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function assets(name = "default") {
  const directory = await mkdtemp(path.join(tmpdir(), "foreachcode-visual-"))
  directories.push(directory)
  const files = {
    wordmark: path.join(directory, `${name}-wordmark.svg`),
    appIcon: path.join(directory, `${name}-app-icon.svg`),
    tuiWordmark: path.join(directory, `${name}-tui.json`),
  }
  await Promise.all([
    Bun.write(
      files.wordmark,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 48"><path d="M0 0h240v48H0z"/></svg>',
    ),
    Bun.write(
      files.appIcon,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><title>ForeachCode application icon</title><path d="M0 0h128v128H0z"/></svg>',
    ),
    Bun.write(
      files.tuiWordmark,
      JSON.stringify({
        width: 3,
        height: 2,
        cells: [
          [1, 0, 1],
          [0, 1, 0],
        ],
      }),
    ),
  ])
  return { directory, files }
}

function profiles(files: Awaited<ReturnType<typeof assets>>["files"]): VisualProfileRegistry {
  return {
    foreachcode: {
      wordmarkSvg: files.wordmark,
      appIconSvg: files.appIcon,
      tuiWordmarkGrid: files.tuiWordmark,
    },
  }
}

function options(fixture: Awaited<ReturnType<typeof assets>>, profiles: VisualProfileRegistry, name = "ForeachCode") {
  return { name, stagingDirectory: path.join(fixture.directory, "stage"), defaultProfile: "foreachcode", profiles }
}

describe("resolveVisuals", () => {
  test("resolves the default visual profile and returns content hashes", async () => {
    const fixture = await assets()
    const result = await resolveVisuals({}, options(fixture, profiles(fixture.files)))

    expect(result.profile).toBe("foreachcode")
    expect(result.wordmark.path).toBe(fixture.files.wordmark)
    expect(result.appIcon.path).toBe(path.join(fixture.directory, "stage", "app-icon.svg"))
    expect(result.tuiWordmark.path).toBe(fixture.files.tuiWordmark)
    expect(result.wordmark.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.appIcon.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.tuiWordmark.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.tuiWordmark.cells)).toBe(true)
  })

  test("rejects incomplete profiles instead of generating missing brand resources", async () => {
    const fixture = await assets()
    const registry = { foreachcode: { appIconSvg: fixture.files.appIcon } } as unknown as VisualProfileRegistry

    await expect(resolveVisuals({}, options(fixture, registry, "FKGCODE"))).rejects.toThrow("wordmarkSvg")
  })

  test("materializes a branded app icon title without modifying the profile source", async () => {
    const fixture = await assets()
    const source = await Bun.file(fixture.files.appIcon).text()
    const result = await resolveVisuals({}, options(fixture, profiles(fixture.files), "FKGCODE"))
    const staged = await Bun.file(result.appIcon.path).text()

    expect(result.appIcon.path).toBe(path.join(fixture.directory, "stage", "app-icon.svg"))
    expect(staged).toContain("<title>FKGCODE application icon</title>")
    expect(staged).not.toContain("ForeachCode")
    expect(await Bun.file(fixture.files.appIcon).text()).toBe(source)
    expect(result.appIcon.sha256).toBe(Bun.CryptoHasher.hash("sha256", staged, "hex"))
  })

  test("replaces a custom app icon title while preserving its title attributes", async () => {
    const fixture = await assets()
    const custom = path.join(fixture.directory, "custom-icon.svg")
    await Bun.write(
      custom,
      '<svg viewBox="0 0 32 32" aria-labelledby="icon-title"><title id="icon-title">Another Product</title><path d="M1 1h30v30H1z"/></svg>',
    )
    const result = await resolveVisuals({ appIconSvg: custom }, options(fixture, profiles(fixture.files), "A&B"))
    const staged = await Bun.file(result.appIcon.path).text()

    expect(staged).toContain('<title id="icon-title">A&amp;B application icon</title>')
    expect(staged).not.toContain("Another Product")
    expect(await Bun.file(custom).text()).toContain("Another Product")
  })

  test("independently overrides each visual from a profile", async () => {
    const base = await assets("base")
    const override = await assets("override")
    await Promise.all([
      Bun.write(override.files.wordmark, '<svg viewBox="0 0 300 60"><path d="M1 1h1v1z"/></svg>'),
      Bun.write(override.files.appIcon, '<svg viewBox="0 0 256 256"><path d="M2 2h2v2z"/></svg>'),
      Bun.write(override.files.tuiWordmark, JSON.stringify({ width: 2, height: 1, cells: [[1, 1]] })),
    ])

    const registry = profiles(base.files)
    expect(
      (await resolveVisuals({ wordmarkSvg: override.files.wordmark }, options(base, registry))).wordmark.path,
    ).toBe(override.files.wordmark)
    expect((await resolveVisuals({ appIconSvg: override.files.appIcon }, options(base, registry))).appIcon.path).toBe(
      path.join(base.directory, "stage", "app-icon.svg"),
    )
    expect(
      (await resolveVisuals({ tuiWordmarkGrid: override.files.tuiWordmark }, options(base, registry))).tuiWordmark.path,
    ).toBe(override.files.tuiWordmark)
  })

  test("selects an explicit profile without retaining assets from the previous resolution", async () => {
    const base = await assets("base")
    const alternate = await assets("alternate")
    await Promise.all([
      Bun.write(alternate.files.wordmark, '<svg viewBox="0 0 320 64"><path d="M3 3h3v3z"/></svg>'),
      Bun.write(alternate.files.appIcon, '<svg viewBox="0 0 512 512"><path d="M4 4h4v4z"/></svg>'),
      Bun.write(alternate.files.tuiWordmark, JSON.stringify({ width: 1, height: 1, cells: [[1]] })),
    ])
    const registry = {
      foreachcode: profiles(base.files).foreachcode!,
      alternate: profiles(alternate.files).foreachcode!,
    }

    const first = await resolveVisuals({}, options(base, registry))
    const second = await resolveVisuals({ visualProfile: "alternate" }, options(base, registry))
    expect(first.wordmark.path).toBe(base.files.wordmark)
    expect(second).toMatchObject({
      profile: "alternate",
      wordmark: { path: alternate.files.wordmark },
      appIcon: { path: path.join(base.directory, "stage", "app-icon.svg") },
      tuiWordmark: { path: alternate.files.tuiWordmark },
    })
    expect(second.sha256).not.toBe(first.sha256)
  })

  test("rejects executable or externally loaded SVG content", async () => {
    const fixture = await assets()
    const invalid = [
      '<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>',
      '<svg viewBox="0 0 10 10"><image href="https://example.com/icon.png"/></svg>',
      '<svg viewBox="0 0 10 10"><style>@import url("theme.css")</style></svg>',
      '<!DOCTYPE svg SYSTEM "https://example.com/svg.dtd"><svg viewBox="0 0 10 10"/>',
      '<svg viewBox="0 0 10 10" xml:base="https://example.com/"><use href="#icon"/></svg>',
      '<svg viewBox="0 0 10 10"><set attributeName="href" to="https://example.com/icon.svg"/></svg>',
    ]

    for (const [index, value] of invalid.entries()) {
      const target = path.join(fixture.directory, `invalid-${index}.svg`)
      await Bun.write(target, value)
      expect(resolveVisuals({ wordmarkSvg: target }, options(fixture, profiles(fixture.files)))).rejects.toThrow(
        /unsafe SVG/i,
      )
    }
  })

  test("requires a valid viewBox and a square app icon", async () => {
    const fixture = await assets()
    const missing = path.join(fixture.directory, "missing-viewbox.svg")
    const nonSquare = path.join(fixture.directory, "non-square.svg")
    const invalid = path.join(fixture.directory, "invalid-viewbox.svg")
    await Promise.all([
      Bun.write(missing, '<svg><path d="M0 0"/></svg>'),
      Bun.write(nonSquare, '<svg viewBox="0 0 128 64"/>'),
      Bun.write(invalid, '<svg viewBox="0 0 NaN 64"/>'),
    ])

    const registry = profiles(fixture.files)
    expect(resolveVisuals({ wordmarkSvg: missing }, options(fixture, registry))).rejects.toThrow(/viewBox/)
    expect(resolveVisuals({ appIconSvg: nonSquare }, options(fixture, registry))).rejects.toThrow(/square/)
    expect(resolveVisuals({ wordmarkSvg: invalid }, options(fixture, registry))).rejects.toThrow(/viewBox/)
  })

  test("validates TUI dimensions, cells, and control characters", async () => {
    const fixture = await assets()
    const values = [
      { value: { width: 81, height: 1, cells: [Array.from({ length: 81 }, () => 1)] }, message: /width/ },
      { value: { width: 2, height: 1, cells: [[1]] }, message: /width/ },
      { value: { width: 1, height: 1, cells: [[2]] }, message: /cell/ },
      { value: { width: 1, height: 1, cells: [["\u001b[31m"]] }, message: /control character/ },
    ]

    for (const [index, item] of values.entries()) {
      const target = path.join(fixture.directory, `invalid-${index}.json`)
      await Bun.write(target, JSON.stringify(item.value))
      expect(resolveVisuals({ tuiWordmarkGrid: target }, options(fixture, profiles(fixture.files)))).rejects.toThrow(
        item.message,
      )
    }
  })

  test("uses resolved content rather than source paths for the stable cache identity", async () => {
    const first = await assets("first")
    const second = await assets("second")
    await Promise.all([
      Bun.write(second.files.wordmark, await Bun.file(first.files.wordmark).text()),
      Bun.write(second.files.appIcon, await Bun.file(first.files.appIcon).text()),
      Bun.write(second.files.tuiWordmark, await Bun.file(first.files.tuiWordmark).text()),
    ])

    const a = await resolveVisuals({}, options(first, profiles(first.files)))
    const b = await resolveVisuals(
      {},
      {
        name: "ForeachCode",
        stagingDirectory: path.join(second.directory, "stage"),
        defaultProfile: "another",
        profiles: { another: profiles(second.files).foreachcode! },
      },
    )
    expect(a.sha256).toBe(b.sha256)

    await Bun.write(second.files.wordmark, '<svg viewBox="0 0 240 48"><path d="M2 2h2v2z"/></svg>')
    const changed = await resolveVisuals(
      { wordmarkSvg: second.files.wordmark },
      {
        name: "ForeachCode",
        stagingDirectory: path.join(second.directory, "changed-stage"),
        defaultProfile: "another",
        profiles: { another: profiles(second.files).foreachcode! },
      },
    )
    expect(changed.sha256).not.toBe(a.sha256)
  })

  test("fails instead of falling back when a profile or override is unavailable", async () => {
    const fixture = await assets()
    expect(
      resolveVisuals({}, { ...options(fixture, profiles(fixture.files)), defaultProfile: "missing" }),
    ).rejects.toThrow(/visual profile/i)
    expect(
      resolveVisuals(
        { appIconSvg: path.join(fixture.directory, "does-not-exist.svg") },
        options(fixture, profiles(fixture.files)),
      ),
    ).rejects.toThrow(/does not exist/i)
  })
})
