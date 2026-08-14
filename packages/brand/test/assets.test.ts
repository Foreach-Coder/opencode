import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { resolveVisualAssets } from "../src/assets-config"

const wordmarkSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 3"><path d="M0 0h12v3H0z"/></svg>'
const appIconSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>'
const tuiWordmarkGrid = {
  width: 3,
  height: 2,
  cells: [
    [1, 0, 1],
    [0, 1, 0],
  ],
} as const

describe("compile-time visual assets", () => {
  test("resolves validated visual content without exposing source paths", () => {
    const result = resolveVisualAssets(JSON.stringify({ wordmarkSvg, appIconSvg, tuiWordmarkGrid }))

    expect(result.wordmark).toEqual({
      svg: wordmarkSvg,
      dataUri: `data:image/svg+xml,${encodeURIComponent(wordmarkSvg)}`,
      viewBox: [0, 0, 12, 3],
      usesCurrentColor: false,
    })
    expect(result.tuiWordmarkGrid).toEqual(tuiWordmarkGrid)
    expect(result.appIcon).toEqual({
      svg: appIconSvg,
      dataUri: `data:image/svg+xml,${encodeURIComponent(appIconSvg)}`,
      viewBox: [0, 0, 16, 16],
      usesCurrentColor: false,
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.tuiWordmarkGrid?.cells[0])).toBe(true)
  })

  test("marks theme-color wordmarks for color-preserving UI rendering", () => {
    expect(
      resolveVisualAssets(
        JSON.stringify({
          wordmarkSvg: '<svg viewBox="0 0 1 1"><path fill="currentColor" d="M0 0h1v1z"/></svg>',
          appIconSvg,
          tuiWordmarkGrid,
        }),
      ).wordmark?.usesCurrentColor,
    ).toBe(true)
  })

  test("rejects a missing compile definition or required app icon", () => {
    expect(() => resolveVisualAssets()).toThrow("required")
    expect(() => resolveVisualAssets(JSON.stringify({ wordmarkSvg, tuiWordmarkGrid }))).toThrow("appIconSvg")
  })

  test("rejects malformed compile definitions", () => {
    expect(() => resolveVisualAssets("[]")).toThrow("PRODUCT_VISUAL_JSON")
    expect(() =>
      resolveVisualAssets(JSON.stringify({ wordmarkSvg: "<svg></svg>", appIconSvg, tuiWordmarkGrid })),
    ).toThrow("viewBox")
    expect(() =>
      resolveVisualAssets(
        JSON.stringify({ wordmarkSvg, appIconSvg, tuiWordmarkGrid: { width: 2, height: 1, cells: [[1]] } }),
      ),
    ).toThrow("cells")
  })

  test("supports one browser-safe compile-time injection point", async () => {
    const payload = JSON.stringify({ wordmarkSvg, appIconSvg, tuiWordmarkGrid })
    const result = await Bun.build({
      entrypoints: [fileURLToPath(new URL("../src/assets.ts", import.meta.url))],
      target: "browser",
      define: { PRODUCT_VISUAL_JSON: JSON.stringify(payload) },
    })
    const output = await result.outputs[0]!.text()

    expect(result.success).toBe(true)
    expect(output).toContain("data:image/svg+xml")
    expect(output).not.toContain("typeof PRODUCT_VISUAL_JSON")
    expect(output).not.toContain("process.env")
    expect(output).not.toContain("Bun.env")
  })
})
