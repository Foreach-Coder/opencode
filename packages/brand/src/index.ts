const name = "ForeachCode"
const slug = "foreachcode"
const desktopAppId = `ai.${slug}.desktop`

const desktop = Object.freeze({
  dev: Object.freeze({ name: `${name} Dev`, appId: `${desktopAppId}.dev` }),
  beta: Object.freeze({ name: `${name} Beta`, appId: `${desktopAppId}.beta` }),
  prod: Object.freeze({ name, appId: desktopAppId }),
})

export const Brand = Object.freeze({
  name,
  slug,
  cli: slug,
  protocol: slug,
  directory: slug,
  database: `${slug}.db`,
  log: `${slug}.log`,
  desktopAppId,
  desktop,
})

export type BrandChannel = keyof typeof Brand.desktop

const glyphs = Object.freeze({
  A: "0110/1001/1111/1001/1001",
  B: "1110/1001/1110/1001/1110",
  C: "0111/1000/1000/1000/0111",
  D: "1110/1001/1001/1001/1110",
  E: "1111/1000/1110/1000/1111",
  F: "1111/1000/1110/1000/1000",
  G: "0111/1000/1011/1001/0111",
  H: "1001/1001/1111/1001/1001",
  I: "1111/0110/0110/0110/1111",
  J: "0011/0001/0001/1001/0110",
  K: "1001/1010/1100/1010/1001",
  L: "1000/1000/1000/1000/1111",
  M: "1001/1111/1111/1001/1001",
  N: "1001/1101/1011/1001/1001",
  O: "0110/1001/1001/1001/0110",
  P: "1110/1001/1110/1000/1000",
  Q: "0110/1001/1001/1011/0111",
  R: "1110/1001/1110/1010/1001",
  S: "0111/1000/0110/0001/1110",
  T: "1111/0110/0110/0110/0110",
  U: "1001/1001/1001/1001/0110",
  V: "1001/1001/1001/0110/0110",
  W: "1001/1001/1111/1111/1001",
  X: "1001/1001/0110/1001/1001",
  Y: "1001/1001/0110/0110/0110",
  Z: "1111/0001/0010/0100/1111",
  0: "0110/1001/1011/1101/0110",
  1: "0010/0110/0010/0010/0111",
  2: "1110/0001/0110/1000/1111",
  3: "1110/0001/0110/0001/1110",
  4: "1010/1010/1111/0010/0010",
  5: "1111/1000/1110/0001/1110",
  6: "0111/1000/1110/1001/0110",
  7: "1111/0001/0010/0100/0100",
  8: "0110/1001/0110/1001/0110",
  9: "0110/1001/0111/0001/1110",
  "?": "0110/1001/0010/0000/0010",
})

export const PixelFont = Object.freeze({
  width: 4,
  height: 5,
  gap: 1,
  glyphs,
})

export type PixelCell = {
  x: number
  y: number
  character: number
}

export function layoutPixelText(value: string) {
  const chars = Array.from(value.toUpperCase())
  const widths = chars.map((char) => (char === " " ? 3 : PixelFont.width))
  const starts = widths.map((_, index) => widths.slice(0, index).reduce((sum, width) => sum + width + PixelFont.gap, 0))
  const cells = chars.flatMap((char, character) => {
    if (char === " ") return []
    const rows = (PixelFont.glyphs[char as keyof typeof PixelFont.glyphs] ?? PixelFont.glyphs["?"]).split("/")
    return rows.flatMap((row, y) =>
      Array.from(row).flatMap((cell, x) => (cell === "1" ? [{ x: starts[character] + x, y, character }] : [])),
    )
  })

  return {
    width: widths.reduce((sum, width) => sum + width, 0) + Math.max(0, chars.length - 1) * PixelFont.gap,
    height: PixelFont.height,
    cells,
  }
}

export function pixelAccentIndex(value: string) {
  const chars = Array.from(value)
  const index = chars.findIndex((char, i) => i > 0 && /[A-Z]/.test(char) && /[a-z0-9]/.test(chars[i - 1] ?? ""))
  return index === -1 ? chars.length : index
}

export function renderTerminalPixelText(value: string) {
  const layout = layoutPixelText(value)
  const active = new Set(layout.cells.map((cell) => `${cell.x},${cell.y}`))
  return Array.from({ length: Math.ceil(layout.height / 2) }, (_, row) =>
    Array.from({ length: layout.width }, (_, x) => {
      const top = active.has(`${x},${row * 2}`)
      const bottom = active.has(`${x},${row * 2 + 1}`)
      if (top && bottom) return "█"
      if (top) return "▀"
      if (bottom) return "▄"
      return " "
    }).join(""),
  )
}
