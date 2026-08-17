import { createHash } from "node:crypto"
import { lstat, readFile, readdir, rename, writeFile } from "node:fs/promises"
import { constants, deflateSync, inflateSync } from "node:zlib"
import path from "node:path"
import type { CacheIsolation } from "./cache"
import {
  assertConcreteDirectory,
  ensureSafeDirectory,
  prepareIsolation,
  removeSafeDirectory,
  verifyConcreteFile,
} from "./isolation"
import type { BuildPaths } from "./paths"
import { verifySnapshot } from "./snapshot"

const visualFiles = ["app-icon.png", "app-icon.svg", "brand.json", "wordmark.svg"] as const
const icoSizes = [16, 24, 32, 48, 64, 128, 256] as const
const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const MAX_DIMENSION = 4096
const MAX_PIXELS = 16_777_216
const MAX_INFLATED_BYTES = 67_108_864
const MAX_INPUT_BYTES = 20_000_000
const MAX_IDAT_BYTES = 16_777_216
const allowedElements = new Set([
  "svg",
  "title",
  "image",
  "style",
  "path",
  "g",
  "defs",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
])
const allowedAttributes = new Map([
  ["svg", new Set(["xmlns", "viewBox", "width", "height", "fill", "role", "aria-label"])],
  ["title", new Set<string>()],
  ["image", new Set(["width", "height", "preserveAspectRatio", "href"])],
  ["style", new Set<string>()],
  ["path", new Set(["class", "d", "fill", "stroke", "stroke-width", "transform"])],
  ["g", new Set(["class", "fill", "stroke", "stroke-width", "transform"])],
  ["defs", new Set<string>()],
  ["rect", new Set(["class", "x", "y", "width", "height", "rx", "ry", "fill", "stroke", "transform"])],
  ["circle", new Set(["class", "cx", "cy", "r", "fill", "stroke", "transform"])],
  ["ellipse", new Set(["class", "cx", "cy", "rx", "ry", "fill", "stroke", "transform"])],
  ["line", new Set(["class", "x1", "y1", "x2", "y2", "fill", "stroke", "transform"])],
  ["polyline", new Set(["class", "points", "fill", "stroke", "transform"])],
  ["polygon", new Set(["class", "points", "fill", "stroke", "transform"])],
])

export type AssetDigest = {
  digest: string
  files: Record<(typeof visualFiles)[number], string>
}

export type DerivedAssets = {
  iconIco: string
  faviconSvg: string
  faviconPng: string
  wordmarkSvg: string
}

export async function validateBrandAssets(root: string): Promise<AssetDigest> {
  await verifySnapshot(root)
  const brand = requireBrandConfig(await readUtf8(path.join(root, "brand.json")))
  const iconSvg = await readUtf8(path.join(root, brand.appIconSvg))
  const wordmarkSvg = await readUtf8(path.join(root, brand.wordmarkSvg))
  const iconValidation = await validateSvg(iconSvg, ["./app-icon.png"])
  await validateSvg(wordmarkSvg)
  const iconSize = requireIconSvg(iconSvg, iconValidation.hrefs)
  const png = await validatePng(new Uint8Array(await readFile(path.join(root, "app-icon.png"))))
  if (png.width !== iconSize) throw new Error("品牌 icon SVG viewBox 与 PNG 尺寸不一致")

  const [appIconPng, appIconSvg, brandJson, wordmark] = await Promise.all(
    visualFiles.map(async (file) =>
      createHash("sha256")
        .update(await readFile(path.join(root, file)))
        .digest("hex"),
    ),
  )
  const files = {
    "app-icon.png": appIconPng,
    "app-icon.svg": appIconSvg,
    "brand.json": brandJson,
    "wordmark.svg": wordmark,
  }
  const digest = createHash("sha256")
  for (const file of visualFiles) digest.update(file).update("\0").update(files[file]).update("\0")
  return { digest: digest.digest("hex"), files }
}

export async function visualDigest(root: string) {
  return (await validateBrandAssets(root)).digest
}

export async function validateSvg(svg: string, allowedHrefs: readonly string[] = []) {
  if (!svg || /[\0\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(svg)) throw new Error("SVG 包含非法控制字符")
  if (/<!|<\?/.test(svg)) throw new Error("SVG 拒绝 DOCTYPE、ENTITY、注释和处理指令")
  if (/url\s*\(/i.test(svg)) throw new Error("SVG 拒绝 url() 资源")
  const contentWithoutNamespace = svg.replace(
    /xmlns=(?:"http:\/\/www\.w3\.org\/2000\/svg"|'http:\/\/www\.w3\.org\/2000\/svg')/,
    "",
  )
  const cssOrExternalResource = new RegExp(
    String.raw`[&\\]|/\*|@import|expression\s*\(|behavior\s*:|-moz-binding|(?:https?:|file:|data:|//)`,
    "i",
  )
  if (cssOrExternalResource.test(contentWithoutNamespace)) {
    throw new Error("SVG 拒绝实体、CSS 绕过或外部资源")
  }
  if (!/^\s*<svg\b/.test(svg) || !/<\/svg>\s*$/.test(svg)) throw new Error("SVG 根元素无效")

  const tags = [...svg.matchAll(/<\/?([A-Za-z][\w:.-]*)([^<>]*?)\s*(\/?)>/g)]
  if (!tags.length || svg.replace(/<\/?[A-Za-z][\w:.-]*[^<>]*?>/g, "").includes("<")) {
    throw new Error("SVG XML 结构无效")
  }
  const stack: string[] = []
  const hrefs: string[] = []
  let cursor = 0
  let svgRoots = 0
  for (const tag of tags) {
    if (svg.slice(cursor, tag.index).includes("<") || svg.slice(cursor, tag.index).includes(">")) {
      throw new Error("SVG XML 结构无效")
    }
    const name = tag[1]
    if (name !== name.toLowerCase() || name.includes(":")) throw new Error(`SVG 拒绝非规范元素: ${name}`)
    if (["script", "foreignobject", "object", "embed"].includes(name) || !allowedElements.has(name)) {
      throw new Error(`SVG 拒绝元素: ${name}`)
    }
    if (tag[0].startsWith("</")) {
      if (tag[2].trim()) throw new Error("SVG 结束标签无效")
      if (stack.pop() !== name) throw new Error(`SVG 元素未正确嵌套: ${name}`)
      cursor = tag.index + tag[0].length
      continue
    }
    if (name === "svg" && ++svgRoots !== 1) throw new Error("SVG 只能包含一个根 svg 元素")
    const attributes = parseAttributes(tag[2])
    for (const [attribute, value] of attributes) {
      if (/^on/i.test(attribute) || attribute.toLowerCase() === "xlink:href") {
        throw new Error(`SVG 拒绝危险属性: ${attribute}`)
      }
      if (!allowedAttributes.get(name)?.has(attribute)) throw new Error(`SVG 拒绝属性: ${attribute}`)
      if (attribute === "xmlns" && value !== "http://www.w3.org/2000/svg") throw new Error("SVG xmlns 无效")
      if (attribute === "href" && !allowedHrefs.includes(value))
        throw new Error(`SVG 拒绝外部资源或非白名单引用: ${value}`)
      if (attribute === "href") hrefs.push(value)
      if (attribute !== "xmlns" && /(?:https?:|file:|data:|^\/\/|\\|\.\.|#)/i.test(value)) {
        throw new Error(`SVG 拒绝外部资源或路径绕过: ${value}`)
      }
    }
    if (tag[3] !== "/") stack.push(name)
    cursor = tag.index + tag[0].length
  }
  if (svgRoots !== 1 || stack.length || svg.slice(cursor).includes("<") || svg.slice(cursor).includes(">")) {
    throw new Error("SVG XML 未完整闭合")
  }
  return { hrefs }
}

export async function validatePng(bytes: Uint8Array) {
  const parsed = parsePng(bytes)
  if (parsed.width !== parsed.height) throw new Error("品牌 PNG 必须是正方形")
  decodePixels(parsed)
  return { width: parsed.width, height: parsed.height }
}

export async function deriveDesktopAssets(paths: BuildPaths): Promise<DerivedAssets> {
  const assetDigest = await validateBrandAssets(paths.frameworkRoot)
  requireStagePaths(paths)
  const iconSvg = await readUtf8(path.join(paths.frameworkRoot, "app-icon.svg"))
  const iconValidation = await validateSvg(iconSvg, ["./app-icon.png"])
  requireIconSvg(iconSvg, iconValidation.hrefs)
  const wordmark = new Uint8Array(await readFile(path.join(paths.frameworkRoot, "wordmark.svg")))
  const decoded = decodePixels(parsePng(new Uint8Array(await readFile(path.join(paths.frameworkRoot, "app-icon.png")))))
  const pngs = icoSizes.map((size) => encodePng(resize(decoded, size)))
  const faviconPng = encodePng(resize(decoded, 96))
  const faviconSvg = iconSvg.replace('href="./app-icon.png"', 'href="./favicon.png"')
  if (faviconSvg === iconSvg) throw new Error("品牌 icon SVG 缺少规范 app-icon.png 引用")
  await validateSvg(faviconSvg, ["./favicon.png"])

  const isolation = await prepareIsolation(paths)
  const assetsRoot = path.join(paths.stageDir, "assets")
  const directory = path.join(assetsRoot, assetDigest.digest)
  await ensureSafeDirectory(isolation, paths.workspaceRoot)
  await ensureSafeDirectory(isolation, paths.stageDir)
  await ensureSafeDirectory(isolation, assetsRoot)
  const result = {
    iconIco: path.join(directory, "icon.ico"),
    faviconSvg: path.join(directory, "favicon.svg"),
    faviconPng: path.join(directory, "favicon.png"),
    wordmarkSvg: path.join(directory, "wordmark.svg"),
  }
  await publishAssets(
    isolation,
    assetsRoot,
    directory,
    new Map([
      ["icon.ico", encodeIco(pngs)],
      ["favicon.svg", new TextEncoder().encode(faviconSvg)],
      ["favicon.png", faviconPng],
      ["wordmark.svg", wordmark],
    ]),
  )
  return result
}

type ParsedPng = {
  width: number
  height: number
  inflatedBytes: number
  compressed: Uint8Array
}

type Pixels = {
  width: number
  height: number
  data: Uint8Array
}

export function resizeRgba(data: Uint8Array, width: number, height: number, size: number) {
  if (![width, height, size].every((value) => Number.isSafeInteger(value) && value > 0 && value <= MAX_DIMENSION)) {
    throw new Error("RGBA 缩放尺寸超出资源预算")
  }
  const sourcePixels = checkedMultiply(width, height, MAX_PIXELS, "RGBA 源像素超出资源预算")
  const sourceBytes = checkedMultiply(sourcePixels, 4, MAX_INFLATED_BYTES, "RGBA 源字节超出资源预算")
  if (data.length !== sourceBytes) throw new Error("RGBA 源字节长度与尺寸不匹配")
  checkedMultiply(size, size, MAX_PIXELS, "RGBA 目标像素超出资源预算")
  return resize({ width, height, data }, size).data
}

function parsePng(bytes: Uint8Array): ParsedPng {
  if (bytes.length > MAX_INPUT_BYTES) throw new Error("PNG 输入超出资源预算")
  if (bytes.length < 45 || !pngSignature.every((byte, index) => bytes[index] === byte)) {
    throw new Error("PNG 签名或结构无效")
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const idat: Uint8Array[] = []
  let offset = 8
  let width = 0
  let height = 0
  let chunkIndex = 0
  let sawIdat = false
  let endedIdat = false
  let sawIend = false
  let idatBytes = 0
  let inflatedBytes = 0
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw new Error("PNG chunk 被截断")
    const length = view.getUint32(offset)
    const end = offset + 12 + length
    if (length > 64 * 1024 * 1024 || end > bytes.length) throw new Error("PNG chunk 长度越界或被截断")
    const type = new TextDecoder("ascii", { fatal: true }).decode(bytes.subarray(offset + 4, offset + 8))
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error("PNG chunk 类型无效")
    if (type === "IDAT") {
      idatBytes = checkedAdd(idatBytes, length, MAX_IDAT_BYTES, "PNG IDAT 资源预算")
    }
    const expectedCrc = view.getUint32(offset + 8 + length)
    const actualCrc = crc32(bytes.subarray(offset + 4, offset + 8 + length))
    if (expectedCrc !== actualCrc) throw new Error(`PNG ${type} chunk CRC 不匹配`)
    if (chunkIndex === 0 && type !== "IHDR") throw new Error("PNG 首个 chunk 必须是 IHDR")
    if (type === "IHDR") {
      if (chunkIndex !== 0 || length !== 13) throw new Error("PNG IHDR 无效或重复")
      width = view.getUint32(offset + 8)
      height = view.getUint32(offset + 12)
      if (!width || !height) throw new Error("PNG IHDR 尺寸无效")
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) throw new Error("PNG 维度超出资源预算")
      checkedMultiply(width, height, MAX_PIXELS, "PNG 像素超出资源预算")
      const rowBytes = checkedMultiply(width, 4, MAX_INFLATED_BYTES, "PNG 行字节超出资源预算")
      inflatedBytes = checkedMultiply(
        checkedAdd(rowBytes, 1, MAX_INFLATED_BYTES, "PNG 行字节超出资源预算"),
        height,
        MAX_INFLATED_BYTES,
        "PNG 解压字节超出资源预算",
      )
      if (
        bytes[offset + 16] !== 8 ||
        bytes[offset + 17] !== 6 ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        bytes[offset + 20] !== 0
      ) {
        throw new Error("PNG 只接受 8-bit RGBA、compression/filter method 0、non-interlaced")
      }
    } else if (type === "IDAT") {
      if (endedIdat || sawIend || length === 0) throw new Error("PNG IDAT 顺序或长度无效")
      sawIdat = true
      idat.push(bytes.slice(offset + 8, offset + 8 + length))
    } else if (type === "IEND") {
      if (!sawIdat || sawIend || length !== 0 || end !== bytes.length) throw new Error("PNG IEND 无效或不是唯一末块")
      sawIend = true
    } else {
      throw new Error(`PNG 拒绝非规范 chunk: ${type}`)
    }
    if (sawIdat && type !== "IDAT" && type !== "IEND") endedIdat = true
    offset = end
    chunkIndex += 1
  }
  if (!sawIend || offset !== bytes.length) throw new Error("PNG 缺少完整 IEND")
  return { width, height, inflatedBytes, compressed: concat(idat) }
}

function decodePixels(png: ParsedPng): Pixels {
  const stride = png.width * 4
  let filtered: Uint8Array
  try {
    filtered = new Uint8Array(inflateSync(png.compressed, { maxOutputLength: png.inflatedBytes }))
  } catch (error) {
    throw new Error("PNG IDAT 压缩数据无效或被截断", { cause: error })
  }
  if (filtered.length !== png.inflatedBytes) throw new Error("PNG IDAT 解压长度与 IHDR 不匹配")
  const pixels = new Uint8Array(stride * png.height)
  for (let y = 0; y < png.height; y++) {
    const filter = filtered[y * (stride + 1)]
    if (filter > 4) throw new Error("PNG scanline filter 无效")
    const source = y * (stride + 1) + 1
    const target = y * stride
    for (let x = 0; x < stride; x++) {
      const raw = filtered[source + x]
      const left = x >= 4 ? pixels[target + x - 4] : 0
      const up = y ? pixels[target + x - stride] : 0
      const upperLeft = y && x >= 4 ? pixels[target + x - stride - 4] : 0
      pixels[target + x] =
        filter === 0
          ? raw
          : filter === 1
            ? raw + left
            : filter === 2
              ? raw + up
              : filter === 3
                ? raw + Math.floor((left + up) / 2)
                : raw + paeth(left, up, upperLeft)
    }
  }
  return { width: png.width, height: png.height, data: pixels }
}

function resize(source: Pixels, size: number): Pixels {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    const sourceY = Math.max(0, Math.min(source.height - 1, ((y + 0.5) * source.height) / size - 0.5))
    const y0 = Math.floor(sourceY)
    const y1 = Math.min(source.height - 1, y0 + 1)
    const fy = sourceY - y0
    for (let x = 0; x < size; x++) {
      const sourceX = Math.max(0, Math.min(source.width - 1, ((x + 0.5) * source.width) / size - 0.5))
      const x0 = Math.floor(sourceX)
      const x1 = Math.min(source.width - 1, x0 + 1)
      const fx = sourceX - x0
      const offsets = [
        (y0 * source.width + x0) * 4,
        (y0 * source.width + x1) * 4,
        (y1 * source.width + x0) * 4,
        (y1 * source.width + x1) * 4,
      ]
      const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy]
      const alpha = offsets.reduce((total, offset, index) => total + source.data[offset + 3] * weights[index], 0)
      const target = (y * size + x) * 4
      const roundedAlpha = clampByte(alpha)
      data[target + 3] = roundedAlpha
      if (roundedAlpha === 0) continue
      for (let channel = 0; channel < 3; channel++) {
        const premultiplied = offsets.reduce(
          (total, offset, index) =>
            total + ((source.data[offset + channel] * source.data[offset + 3]) / 255) * weights[index],
          0,
        )
        data[target + channel] = clampByte((premultiplied * 255) / alpha)
      }
    }
  }
  return { width: size, height: size, data }
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function encodePng(pixels: Pixels) {
  const stride = pixels.width * 4
  const raw = new Uint8Array((stride + 1) * pixels.height)
  for (let y = 0; y < pixels.height; y++) {
    raw.set(pixels.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, pixels.width)
  view.setUint32(4, pixels.height)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const compressed = new Uint8Array(
    deflateSync(raw, {
      level: 9,
      strategy: constants.Z_DEFAULT_STRATEGY,
      windowBits: 15,
      memLevel: 8,
    }),
  )
  return concat([
    pngSignature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array()),
  ])
}

function encodeIco(pngs: readonly Uint8Array[]) {
  if (pngs.length !== icoSizes.length) throw new Error("ICO 尺寸数量无效")
  const directorySize = 6 + icoSizes.length * 16
  const result = new Uint8Array(directorySize + pngs.reduce((total, png) => total + png.length, 0))
  const view = new DataView(result.buffer)
  view.setUint16(2, 1, true)
  view.setUint16(4, icoSizes.length, true)
  let payloadOffset = directorySize
  icoSizes.forEach((size, index) => {
    const entry = 6 + index * 16
    result[entry] = size === 256 ? 0 : size
    result[entry + 1] = size === 256 ? 0 : size
    view.setUint16(entry + 4, 1, true)
    view.setUint16(entry + 6, 32, true)
    view.setUint32(entry + 8, pngs[index].length, true)
    view.setUint32(entry + 12, payloadOffset, true)
    result.set(pngs[index], payloadOffset)
    payloadOffset += pngs[index].length
  })
  return result
}

function pngChunk(type: string, data: Uint8Array) {
  const result = new Uint8Array(data.length + 12)
  const view = new DataView(result.buffer)
  view.setUint32(0, data.length)
  const typeBytes = new TextEncoder().encode(type)
  result.set(typeBytes, 4)
  result.set(data, 8)
  view.setUint32(data.length + 8, crc32(result.subarray(4, data.length + 8)))
  return result
}

function parseAttributes(input: string) {
  const attributes = new Map<string, string>()
  let rest = input.trim()
  while (rest) {
    const match = /^([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest)
    if (!match) throw new Error(`SVG 属性语法无效: ${rest}`)
    if (attributes.has(match[1])) throw new Error(`SVG 属性重复: ${match[1]}`)
    attributes.set(match[1], match[2] ?? match[3])
    rest = rest.slice(match[0].length).trim()
  }
  return attributes
}

function requireIconSvg(svg: string, hrefs: readonly string[]) {
  const opening = /^\s*<svg\b([^<>]*)>/.exec(svg)
  if (!opening) throw new Error("品牌 icon SVG 根元素无效")
  const viewBox = parseAttributes(opening[1])
    .get("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (!viewBox || viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) {
    throw new Error("品牌 icon SVG viewBox 无效")
  }
  if (viewBox[0] !== 0 || viewBox[1] !== 0 || viewBox[2] <= 0 || viewBox[2] !== viewBox[3]) {
    throw new Error("品牌 icon SVG 必须使用正方形正 viewBox")
  }
  const titles = [...svg.matchAll(/<title>([^<>]*)<\/title>/g)]
  if (titles.length !== 1 || titles[0][1] !== "BluedCode application icon") {
    throw new Error("品牌 icon SVG title 必须是 BluedCode application icon")
  }
  if (hrefs.length !== 1 || hrefs[0] !== "./app-icon.png") {
    throw new Error("品牌 icon SVG 必须恰好一个 href=./app-icon.png")
  }
  return viewBox[2]
}

function requireBrandConfig(content: string) {
  const parsed: unknown = JSON.parse(content)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("brand.json 无效")
  if (!("appIconSvg" in parsed) || parsed.appIconSvg !== "app-icon.svg") throw new Error("brand.json appIconSvg 无效")
  if (!("wordmarkSvg" in parsed) || parsed.wordmarkSvg !== "wordmark.svg")
    throw new Error("brand.json wordmarkSvg 无效")
  if (!("tuiWordmarkGrid" in parsed) || parsed.tuiWordmarkGrid !== "tui.json") {
    throw new Error("brand.json tuiWordmarkGrid 无效")
  }
  return { appIconSvg: parsed.appIconSvg, wordmarkSvg: parsed.wordmarkSvg }
}

function requireStagePaths(paths: BuildPaths) {
  if (path.relative(path.join(paths.outputRoot, "workspaces"), path.resolve(paths.workspaceRoot)).startsWith("..")) {
    throw new Error("品牌资源 workspace 路径越出隔离 workspaces")
  }
  if (path.relative(path.join(paths.workspaceRoot, "stage"), path.resolve(paths.stageDir)) !== "") {
    throw new Error("品牌资源只能写入 workspace stage")
  }
}

async function publishAssets(
  isolation: CacheIsolation,
  assetsRoot: string,
  target: string,
  files: ReadonlyMap<string, Uint8Array>,
) {
  if (await lstatOptional(target)) {
    await verifyImmutableTarget(assetsRoot, target, files)
    return
  }
  const temporary = path.join(assetsRoot, `.tmp-${path.basename(target)}-${process.pid}-${crypto.randomUUID()}`)
  await ensureSafeDirectory(isolation, temporary)
  try {
    await Promise.all(
      [...files].map(([file, content]) => writeFile(path.join(temporary, file), content, { flag: "wx" })),
    )
    await verifyImmutableTarget(assetsRoot, temporary, files)
    try {
      await rename(temporary, target)
    } catch (error) {
      if (!(await lstatOptional(target))) throw error
      await verifyImmutableTarget(assetsRoot, target, files)
      await removeSafeDirectory(isolation, temporary)
      return
    }
    await verifyImmutableTarget(assetsRoot, target, files)
  } catch (error) {
    if (await lstatOptional(temporary)) await removeSafeDirectory(isolation, temporary)
    throw error
  }
}

async function verifyImmutableTarget(root: string, target: string, files: ReadonlyMap<string, Uint8Array>) {
  try {
    await assertConcreteDirectory(root, target)
    const entries = await readdir(target, { withFileTypes: true })
    const expected = [...files.keys()].sort()
    const actual = entries.map((entry) => entry.name).sort()
    if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) {
      throw new Error("文件集合不完整")
    }
    await Promise.all(
      [...files].map(([file, content]) =>
        verifyConcreteFile(target, path.join(target, file), createHash("sha256").update(content).digest("hex")),
      ),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`不可变派生资源目录与预期不匹配: ${message}`, { cause: error })
  }
}

async function readUtf8(file: string) {
  return new TextDecoder("utf-8", { fatal: true }).decode(await readFile(file))
}

function concat(parts: readonly Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function checkedAdd(left: number, right: number, limit: number, message: string) {
  const result = left + right
  if (!Number.isSafeInteger(result) || result > limit) throw new Error(message)
  return result
}

function checkedMultiply(left: number, right: number, limit: number, message: string) {
  const result = left * right
  if (!Number.isSafeInteger(result) || result > limit) throw new Error(message)
  return result
}

function paeth(left: number, up: number, upperLeft: number) {
  const estimate = left + up - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left
  if (upDistance <= upperLeftDistance) return up
  return upperLeft
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

async function lstatOptional(target: string) {
  try {
    return await lstat(target)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}
