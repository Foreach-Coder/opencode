import { mkdir } from "node:fs/promises"
import path from "node:path"

export type VisualProfile = Readonly<{
  wordmarkSvg: string
  appIconSvg: string
  tuiWordmarkGrid: string
}>

export type VisualProfileRegistry = Readonly<Record<string, VisualProfile>>

export type VisualInput = Readonly<{
  visualProfile?: string
  wordmarkSvg?: string
  appIconSvg?: string
  tuiWordmarkGrid?: string
}>

export type VisualOptions = Readonly<{
  name: string
  stagingDirectory: string
  defaultProfile: string
  profiles: VisualProfileRegistry
}>

export type ResolvedSvgAsset = Readonly<{
  path: string
  sha256: string
  viewBox: readonly [number, number, number, number]
}>

export type ResolvedTuiWordmark = Readonly<{
  path: string
  sha256: string
  width: number
  height: number
  cells: readonly (readonly (0 | 1)[])[]
}>

export type ResolvedVisuals = Readonly<{
  profile: string
  wordmark: ResolvedSvgAsset
  appIcon: ResolvedSvgAsset
  tuiWordmark: ResolvedTuiWordmark
  sha256: string
}>

export async function resolveVisuals(input: VisualInput, options: VisualOptions): Promise<ResolvedVisuals> {
  const profileName = input.visualProfile ?? options.defaultProfile
  const profile = options.profiles[profileName]
  if (!profile) throw new Error(`Unknown visual profile: ${profileName}`)

  const wordmarkSource = input.wordmarkSvg ?? profile.wordmarkSvg
  const tuiWordmarkSource = input.tuiWordmarkGrid ?? profile.tuiWordmarkGrid
  if (!wordmarkSource) throw new Error(`Visual profile ${profileName} requires wordmarkSvg`)
  if (!tuiWordmarkSource) throw new Error(`Visual profile ${profileName} requires tuiWordmarkGrid`)
  const stagingDirectory = path.resolve(options.stagingDirectory)
  await mkdir(stagingDirectory, { recursive: true })
  const appIconTarget = path.join(stagingDirectory, "app-icon.svg")
  await writeBrandedAppIcon(options.name, input.appIconSvg ?? profile.appIconSvg, appIconTarget)

  const [wordmark, appIcon, tuiWordmark] = await Promise.all([
    readSvg(wordmarkSource, "wordmark"),
    readSvg(appIconTarget, "app icon", true),
    readTuiWordmark(tuiWordmarkSource),
  ])

  return Object.freeze({
    profile: profileName,
    wordmark,
    appIcon,
    tuiWordmark,
    sha256: hash(["visual-v1", wordmark.sha256, appIcon.sha256, tuiWordmark.sha256].join("\n")),
  })
}

async function writeBrandedAppIcon(name: string, source: string, target: string) {
  const sourcePath = path.resolve(source)
  const file = Bun.file(sourcePath)
  if (!(await file.exists())) throw new Error(`app icon SVG does not exist: ${sourcePath}`)
  const content = await file.text()
  const viewBox = validateSvg(content, "app icon")
  if (viewBox[2] !== viewBox[3]) throw new Error(`App icon SVG viewBox must be square: ${sourcePath}`)
  const title = `${escapeXml(name)} application icon`
  const normalized = /<title\b([^>]*)>[\s\S]*?<\/title>/i.test(content)
    ? content.replace(/<title\b([^>]*)>[\s\S]*?<\/title>/i, `<title$1>${title}</title>`)
    : content.replace(/<svg\b[^>]*>/i, (root) => `${root}<title>${title}</title>`)
  await Bun.write(target, normalized)
}

function escapeXml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!,
  )
}

async function readSvg(source: string, role: string, square = false): Promise<ResolvedSvgAsset> {
  const target = path.resolve(source)
  const file = Bun.file(target)
  if (!(await file.exists())) throw new Error(`${role} SVG does not exist: ${target}`)
  const content = await file.text()
  const viewBox = validateSvg(content, role)
  if (square && viewBox[2] !== viewBox[3]) throw new Error(`App icon SVG viewBox must be square: ${target}`)
  return Object.freeze({ path: target, sha256: hash(content), viewBox: Object.freeze(viewBox) })
}

function validateSvg(content: string, role: string): [number, number, number, number] {
  const root = content.match(/<svg\b[^>]*>/i)?.[0]
  if (!root) throw new Error(`Invalid ${role} SVG: missing svg root`)
  if (
    /<\/?(?:script|foreignObject|iframe|object|embed|audio|video|animate|animateMotion|animateTransform|set)\b/i.test(
      content,
    ) ||
    /<!DOCTYPE\b|<!ENTITY\b/i.test(content) ||
    /\son[a-z]+\s*=/i.test(content) ||
    /@import\b|\bxml:base\s*=/i.test(content)
  )
    throw new Error(`Unsafe SVG content in ${role}`)

  const references = Array.from(content.matchAll(/(?:href|xlink:href)\s*=\s*["']([^"']*)["']/gi), (match) => match[1])
  const urls = Array.from(content.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/gi), (match) => match[1])
  if ([...references, ...urls].some((reference) => !reference?.startsWith("#")))
    throw new Error(`Unsafe SVG external reference in ${role}`)

  const value = root.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
  const viewBox = value
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
    throw new Error(`Invalid ${role} SVG viewBox`)
  return [viewBox[0]!, viewBox[1]!, viewBox[2]!, viewBox[3]!]
}

async function readTuiWordmark(source: string): Promise<ResolvedTuiWordmark> {
  const target = path.resolve(source)
  const file = Bun.file(target)
  if (!(await file.exists())) throw new Error(`TUI wordmark grid does not exist: ${target}`)
  const content = await file.text()
  const parsed = parseTuiWordmark(content)
  return Object.freeze({ path: target, sha256: hash(content), ...parsed })
}

function parseTuiWordmark(content: string) {
  const value: unknown = JSON.parse(content)
  if (containsControlCharacter(value)) throw new Error("TUI wordmark grid contains a control character")
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("TUI wordmark grid must be an object")

  const record = value as Record<string, unknown>
  if (!Number.isInteger(record.width) || (record.width as number) < 1 || (record.width as number) > 80)
    throw new Error("TUI wordmark grid width must be between 1 and 80")
  if (!Number.isInteger(record.height) || (record.height as number) < 1 || (record.height as number) > 16)
    throw new Error("TUI wordmark grid height must be between 1 and 16")
  if (!Array.isArray(record.cells) || record.cells.length !== record.height)
    throw new Error("TUI wordmark grid cells must match its declared height")

  const cells = record.cells.map((row) => {
    if (!Array.isArray(row) || row.length !== record.width)
      throw new Error("TUI wordmark grid cell row must match its declared width")
    return Object.freeze(
      row.map((cell) => {
        if (cell === true || cell === 1) return 1 as const
        if (cell === false || cell === 0) return 0 as const
        throw new Error("TUI wordmark grid cell must be boolean, 0, or 1")
      }),
    )
  })

  return Object.freeze({
    width: record.width as number,
    height: record.height as number,
    cells: Object.freeze(cells),
  })
}

function containsControlCharacter(value: unknown): boolean {
  if (typeof value === "string") return /[\u0000-\u001f\u007f]/.test(value)
  if (Array.isArray(value)) return value.some(containsControlCharacter)
  if (value && typeof value === "object")
    return Object.entries(value).some(([key, item]) => containsControlCharacter(key) || containsControlCharacter(item))
  return false
}

function hash(value: string) {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex")
}
