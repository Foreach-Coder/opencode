export type TuiWordmarkGrid = Readonly<{
  width: number
  height: number
  cells: readonly (readonly (0 | 1)[])[]
}>

export type WordmarkAsset = Readonly<{
  svg: string
  dataUri: string
  viewBox: readonly [number, number, number, number]
  usesCurrentColor: boolean
}>

export type ProductVisualAssets = Readonly<{
  wordmark: WordmarkAsset
  appIcon: WordmarkAsset
  tuiWordmarkGrid: TuiWordmarkGrid
}>

export type ProductVisualDefinition = Readonly<{
  wordmarkSvg: string
  appIconSvg: string
  tuiWordmarkGrid: TuiWordmarkGrid
}>

export function resolveVisualAssets(source?: string): ProductVisualAssets {
  if (source === undefined) throw new Error("PRODUCT_VISUAL_JSON is required")
  const value: unknown = JSON.parse(source)
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid PRODUCT_VISUAL_JSON")

  const wordmarkSvg = Reflect.get(value, "wordmarkSvg")
  const appIconSvg = Reflect.get(value, "appIconSvg")
  const tuiWordmarkGrid = Reflect.get(value, "tuiWordmarkGrid")
  if (typeof wordmarkSvg !== "string") throw new Error("PRODUCT_VISUAL_JSON wordmarkSvg is required")
  if (typeof appIconSvg !== "string") throw new Error("PRODUCT_VISUAL_JSON appIconSvg is required")
  if (tuiWordmarkGrid === undefined) throw new Error("PRODUCT_VISUAL_JSON tuiWordmarkGrid is required")

  return Object.freeze({
    wordmark: svgAsset(wordmarkSvg, "wordmark"),
    appIcon: svgAsset(appIconSvg, "appIcon"),
    tuiWordmarkGrid: grid(tuiWordmarkGrid),
  })
}

function svgAsset(svg: string, role: string): WordmarkAsset {
  const root = svg.match(/<svg\b[^>]*>/i)?.[0]
  if (!root) throw new Error(`Invalid PRODUCT_VISUAL_JSON ${role} SVG root`)
  const raw = root.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
  const viewBox = raw
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (
    !viewBox ||
    viewBox.length !== 4 ||
    viewBox.some((part) => !Number.isFinite(part)) ||
    viewBox[2]! <= 0 ||
    viewBox[3]! <= 0
  )
    throw new Error(`Invalid PRODUCT_VISUAL_JSON ${role} SVG viewBox`)

  return Object.freeze({
    svg,
    dataUri: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    viewBox: Object.freeze([viewBox[0]!, viewBox[1]!, viewBox[2]!, viewBox[3]!] as const),
    usesCurrentColor: /\bcurrentColor\b/i.test(svg),
  })
}

function grid(value: unknown): TuiWordmarkGrid {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid PRODUCT_VISUAL_JSON TUI wordmark grid")
  const width = Reflect.get(value, "width")
  const height = Reflect.get(value, "height")
  const cells = Reflect.get(value, "cells")
  if (!Number.isInteger(width) || (width as number) < 1 || (width as number) > 80)
    throw new Error("Invalid PRODUCT_VISUAL_JSON TUI wordmark grid width")
  if (!Number.isInteger(height) || (height as number) < 1 || (height as number) > 16)
    throw new Error("Invalid PRODUCT_VISUAL_JSON TUI wordmark grid height")
  if (!Array.isArray(cells) || cells.length !== height)
    throw new Error("Invalid PRODUCT_VISUAL_JSON TUI wordmark grid cells")

  return Object.freeze({
    width: width as number,
    height: height as number,
    cells: Object.freeze(
      cells.map((row) => {
        if (!Array.isArray(row) || row.length !== width)
          throw new Error("Invalid PRODUCT_VISUAL_JSON TUI wordmark grid cells")
        return Object.freeze(
          row.map((cell) => {
            if (cell === 0 || cell === false) return 0 as const
            if (cell === 1 || cell === true) return 1 as const
            throw new Error("Invalid PRODUCT_VISUAL_JSON TUI wordmark grid cells")
          }),
        )
      }),
    ),
  })
}
