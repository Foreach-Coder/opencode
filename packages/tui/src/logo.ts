import { Brand, layoutPixelText, pixelAccentIndex, renderTerminalPixelText } from "@opencode-ai/brand"
import { VisualAssets, type TuiWordmarkGrid } from "@opencode-ai/brand/assets"

export function wordmark(name?: string) {
  if (name === undefined) return gridWordmark(VisualAssets.tuiWordmarkGrid)
  const value = name ?? Brand.name
  const layout = layoutPixelText(value)
  const full = [" ".repeat(layout.width), ...renderTerminalPixelText(value)]
  const accent = pixelAccentIndex(value)
  const start = layout.cells
    .filter((cell) => cell.character >= accent)
    .reduce((min, cell) => Math.min(min, cell.x), layout.width)
  const leftWidth = Math.max(0, start - (start < layout.width ? 1 : 0))

  return {
    full,
    left: full.map((row) => row.slice(0, leftWidth)),
    right: full.map((row) => row.slice(start)),
  }
}

export function gridWordmark(grid: TuiWordmarkGrid) {
  const full = [
    " ".repeat(grid.width),
    ...Array.from({ length: Math.ceil(grid.height / 2) }, (_, row) =>
      Array.from({ length: grid.width }, (_, x) => {
        const top = grid.cells[row * 2]?.[x] === 1
        const bottom = grid.cells[row * 2 + 1]?.[x] === 1
        if (top && bottom) return "█"
        if (top) return "▀"
        if (bottom) return "▄"
        return " "
      }).join(""),
    ),
  ]
  return {
    full,
    left: full,
    right: full.map(() => ""),
  }
}

export const logo = wordmark()

const mark = layoutPixelText(Brand.name.slice(0, 1))
const compact = [" ".repeat(mark.width), ...renderTerminalPixelText(Brand.name.slice(0, 1))]

export const go = {
  full: compact,
  left: compact.map(() => ""),
  right: compact,
}

export const marks = "_^~,"
