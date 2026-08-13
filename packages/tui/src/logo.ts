import { Brand, layoutPixelText, pixelAccentIndex, renderTerminalPixelText } from "@opencode-ai/brand"

export function wordmark(name: string = Brand.name) {
  const layout = layoutPixelText(name)
  const full = [" ".repeat(layout.width), ...renderTerminalPixelText(name)]
  const accent = pixelAccentIndex(name)
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

export const logo = wordmark()

const mark = layoutPixelText(Brand.name.slice(0, 1))
const compact = [" ".repeat(mark.width), ...renderTerminalPixelText(Brand.name.slice(0, 1))]

export const go = {
  full: compact,
  left: compact.map(() => ""),
  right: compact,
}

export const marks = "_^~,"
