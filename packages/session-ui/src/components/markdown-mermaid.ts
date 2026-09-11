import { checksum } from "@opencode-ai/core/util/encode"
import DOMPurify from "dompurify"

export type MermaidTheme = "light" | "dark"
export type MermaidFailure = "syntax" | "limit" | "unsafe" | "runtime"
export type MermaidRenderResult =
  | { ok: true; key: string; source: string; svg: string; title?: string }
  | { ok: false; key: string; source: string; reason: MermaidFailure }

type MermaidSuccess = Extract<MermaidRenderResult, { ok: true }>
type CssVariableContext = { fontFamily: boolean }

const maxSourceLength = 50_000
const maxCacheEntries = 100
export const mermaidVersion = "11.17.2"
const svgNamespace = "http://www.w3.org/2000/svg"
const xmlnsNamespace = "http://www.w3.org/2000/xmlns/"
const xlinkNamespace = "http://www.w3.org/1999/xlink"
const forbiddenTags = new Set([
  "a",
  "audio",
  "discard",
  "embed",
  "foreignobject",
  "iframe",
  "object",
  "script",
  "set",
  "video",
  "animate",
  "animatecolor",
  "animatemotion",
  "animatetransform",
  "handler",
])
const linkAttributes = new Set(["href", "xlink:href", "src"])
const ariaSingleReferenceAttributes = new Set(["aria-activedescendant", "aria-errormessage"])
const ariaReferenceListAttributes = new Set([
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
])
const cssProperties = new Set([
  "--mermaid-font-family",
  "align-items",
  "animation",
  "animation-delay",
  "animation-direction",
  "animation-duration",
  "animation-fill-mode",
  "animation-iteration-count",
  "animation-name",
  "animation-play-state",
  "animation-timing-function",
  "background",
  "background-color",
  "border",
  "border-bottom",
  "border-color",
  "border-radius",
  "border-style",
  "border-width",
  "box-shadow",
  "clip-path",
  "color",
  "cursor",
  "display",
  "fill",
  "fill-opacity",
  "filter",
  "flood-color",
  "flood-opacity",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "height",
  "justify-content",
  "line-height",
  "margin",
  "marker-end",
  "marker-mid",
  "marker-start",
  "max-width",
  "opacity",
  "overflow",
  "padding",
  "pointer-events",
  "position",
  "rx",
  "ry",
  "scale",
  "shape-rendering",
  "stop-color",
  "stop-opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "stroke-width",
  "text-align",
  "text-anchor",
  "text-decoration",
  "transform",
  "transform-origin",
  "transition-duration",
  "vertical-align",
  "vector-effect",
  "visibility",
  "white-space",
  "z-index",
])
const cssFunctions = new Set([
  "blur",
  "brightness",
  "calc",
  "clamp",
  "contrast",
  "cubic-bezier",
  "drop-shadow",
  "grayscale",
  "hsl",
  "hsla",
  "hue-rotate",
  "invert",
  "linear-gradient",
  "max",
  "min",
  "opacity",
  "radial-gradient",
  "rgb",
  "rgba",
  "saturate",
  "sepia",
  "steps",
  "url",
  "var",
])

const cache = new Map<string, MermaidSuccess>()
let mermaidImport: Promise<typeof import("mermaid")> | undefined
let renderQueue: Promise<void> = Promise.resolve()
let configuredTheme: MermaidTheme | undefined
let instanceID = 0

export function isMermaidLanguage(language: string | undefined) {
  return language?.trim().split(/\s+/, 1)[0]?.toLowerCase() === "mermaid"
}

export function mermaidSourceKey(source: string) {
  return `${source.length}:${checksum(source) ?? "0"}`
}

export function sanitizeMermaidSvg(svg: string): { svg: string; title?: string } | undefined {
  if (!DOMPurify.isSupported) return
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") return
  if (/<!doctype|<!entity|<\?/i.test(svg)) return

  const original = parseSvg(svg)
  if (!original) return
  normalizeMermaidFontSelector(original)
  if (!isSafeSvg(original)) return

  const styles = Array.from(original.children).filter((element) => element.localName.toLowerCase() === "style")
  const css = styles.map((element) => element.textContent ?? "")
  styles.forEach((element) => element.remove())
  const before = treeSignature(original)

  const sanitized = DOMPurify.sanitize(new XMLSerializer().serializeToString(original), {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: Array.from(forbiddenTags),
    ADD_TAGS: ["use"],
    ADD_ATTR: ["href", "xlink:href", "role"],
    SANITIZE_DOM: true,
  })
  if (removedInputContent()) return
  const parsed = parseSvg(String(sanitized))
  if (!parsed || !isSafeSvg(parsed)) return
  if (treeSignature(parsed) !== before) return

  for (const stylesheet of css.toReversed()) {
    const style = parsed.ownerDocument.createElementNS(svgNamespace, "style")
    style.textContent = stylesheet
    parsed.insertBefore(style, parsed.firstChild)
  }
  if (!isSafeSvg(parsed)) return

  const title = parsed.querySelector("title")?.textContent?.trim() || undefined
  return { svg: new XMLSerializer().serializeToString(parsed), title }
}

export async function renderMermaid(source: string, theme: MermaidTheme): Promise<MermaidRenderResult> {
  const key = `${mermaidVersion}:${theme}:${mermaidSourceKey(source)}`
  if (source.length > maxSourceLength) return { ok: false, key, source, reason: "limit" }

  const cached = cache.get(key)
  if (cached?.source === source) {
    cache.delete(key)
    cache.set(key, cached)
    return instantiate(cached) ?? { ok: false, key, source, reason: "unsafe" }
  }

  return enqueueRender(async () => {
    const second = cache.get(key)
    if (second?.source === source) {
      cache.delete(key)
      cache.set(key, second)
      return instantiate(second) ?? { ok: false, key, source, reason: "unsafe" }
    }

    try {
      const mermaid = (await loadMermaid()).default
      if (configuredTheme !== theme) {
        mermaid.initialize(configuration(theme))
        configuredTheme = theme
      }

      const id = `mermaid-${theme}-${source.length}-${checksum(source) ?? "0"}`
      const rendered = await mermaid.render(id, source)
      const safe = sanitizeMermaidSvg(rendered.svg)
      if (!safe) return { ok: false, key, source, reason: "unsafe" }

      const result: MermaidSuccess = { ok: true, key, source, ...safe }
      touchCache(key, result)
      return instantiate(result) ?? { ok: false, key, source, reason: "unsafe" }
    } catch (error) {
      return { ok: false, key, source, reason: classifyFailure(error) }
    }
  })
}

export function clearMermaidCache() {
  cache.clear()
}

function loadMermaid() {
  mermaidImport ??= import("mermaid")
  return mermaidImport
}

function enqueueRender<T>(operation: () => Promise<T>) {
  const result = renderQueue.then(operation, operation)
  renderQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

function configuration(theme: MermaidTheme) {
  const dark = theme === "dark"
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    htmlLabels: false,
    maxTextSize: maxSourceLength,
    maxEdges: 500,
    suppressErrorRendering: true,
    arrowMarkerAbsolute: false,
    deterministicIds: true,
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    theme: "base" as const,
    darkMode: dark,
    themeCSS: "",
    themeVariables: dark
      ? {
          background: "#18181b",
          primaryColor: "#27272a",
          primaryTextColor: "#fafafa",
          primaryBorderColor: "#71717a",
          secondaryColor: "#3f3f46",
          tertiaryColor: "#18181b",
          lineColor: "#a1a1aa",
          textColor: "#fafafa",
        }
      : {
          background: "#ffffff",
          primaryColor: "#f4f4f5",
          primaryTextColor: "#18181b",
          primaryBorderColor: "#a1a1aa",
          secondaryColor: "#e4e4e7",
          tertiaryColor: "#fafafa",
          lineColor: "#52525b",
          textColor: "#18181b",
        },
    secure: [
      "secure",
      "securityLevel",
      "startOnLoad",
      "htmlLabels",
      "maxTextSize",
      "maxEdges",
      "theme",
      "themeVariables",
      "themeCSS",
      "fontFamily",
      "altFontFamily",
      "darkMode",
      "arrowMarkerAbsolute",
      "deterministicIds",
      "deterministicIDSeed",
      "suppressErrorRendering",
    ],
  }
}

function parseSvg(svg: string) {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml")
  if (document.getElementsByTagName("parsererror").length > 0) return
  const root = document.documentElement
  if (root.localName.toLowerCase() !== "svg") return
  if (root.namespaceURI !== svgNamespace) return
  return root
}

function removedInputContent() {
  return DOMPurify.removed.some((entry) => {
    const element = "element" in entry ? entry.element : undefined
    return !(element?.nodeName === "BODY" && (element as Element).namespaceURI === "http://www.w3.org/1999/xhtml")
  })
}

function normalizeMermaidFontSelector(root: Element) {
  const generatedSelector = `#${root.id} :root`
  for (const style of Array.from(root.children).filter((element) => element.localName.toLowerCase() === "style")) {
    const blocks = cssBlocks(style.textContent ?? "")
    if (!blocks) continue
    let changed = false
    const css = blocks.map((block) => {
      const declarations = cssDeclarations(block.body)
      if (
        block.header === generatedSelector &&
        declarations?.length === 1 &&
        declarations[0].property === "--mermaid-font-family" &&
        isTrustedFontFamily(declarations[0].value)
      ) {
        changed = true
        return `#${root.id}{${block.body}}`
      }
      return `${block.header}{${block.body}}`
    })
    if (changed) style.textContent = css.join("")
  }
}

function cssVariableContext(root: Element): CssVariableContext | undefined {
  let fontFamilyDefinitions = 0
  const inspect = (css: string, rootTarget: boolean) => {
    const declarations = cssDeclarations(css)
    if (!declarations) return false
    for (const declaration of declarations) {
      if (!declaration.property.startsWith("--")) continue
      if (declaration.property !== "--mermaid-font-family") return false
      if (!rootTarget || !isTrustedFontFamily(declaration.value)) return false
      fontFamilyDefinitions++
    }
    return true
  }

  const inline = root.getAttribute("style")
  if (inline && !inspect(inline, true)) return

  for (const style of Array.from(root.children).filter((element) => element.localName.toLowerCase() === "style")) {
    const blocks = cssBlocks(style.textContent ?? "")
    if (!blocks) return
    for (const block of blocks) {
      if (block.header.startsWith("@")) {
        if (/--[A-Za-z0-9_-]+\s*:/.test(block.body)) return
        continue
      }
      const selectors = block.header.split(",").map((selector) => selector.trim())
      if (!inspect(block.body, selectors.length > 0 && selectors.every((selector) => selector === `#${root.id}`)))
        return
    }
  }

  if (fontFamilyDefinitions > 1) return
  return { fontFamily: fontFamilyDefinitions === 1 }
}

function isTrustedFontFamily(value: string) {
  return value.replace(/\s+/g, "").toLowerCase() === "ui-sans-serif,system-ui,sans-serif"
}

function isSafeSvg(root: Element, keyframeNamespace?: string) {
  const ids = svgIDs(root)
  if (!ids) return false
  const variables = cssVariableContext(root)
  if (!variables) return false
  if (!isSafeRootAttributes(root, ids, variables)) return false
  if (!isSafeFilterGraph(root)) return false

  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (element.namespaceURI !== svgNamespace) return false
    if (forbiddenTags.has(element.localName.toLowerCase())) return false
    if (element.localName.toLowerCase() === "style") {
      if (element.parentElement !== root) return false
      if (element.attributes.length > 0) return false
      if (!isSafeStylesheet(element.textContent ?? "", root.id, ids, variables, keyframeNamespace)) return false
    }

    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase()
      const localName = attribute.localName.toLowerCase()
      const value = attribute.value.trim()
      if (localName.startsWith("on")) return false
      if (attribute.namespaceURI === "http://www.w3.org/XML/1998/namespace" && localName === "base") return false
      if (
        name === "style" &&
        !(element === root ? isSafeRootDeclarations(value) : isSafeCssDeclarations(value, ids, variables))
      )
        return false
      if ((linkAttributes.has(name) || localName === "href") && !isLocalFragment(value, ids)) return false
      if (ariaSingleReferenceAttributes.has(name) && !isLocalIDToken(value, ids)) return false
      if (ariaReferenceListAttributes.has(name) && !hasOnlyLocalIDTokens(value, ids)) return false
      if (/\burl\s*\(/i.test(value) && !hasOnlyLocalUrls(value, ids)) return false
      if (/javascript\s*:|vbscript\s*:|data\s*:/i.test(compact(value))) return false
    }
  }
  return true
}

function isSafeRootAttributes(root: Element, ids: Map<string, number>, variables: CssVariableContext) {
  for (const attribute of root.attributes) {
    const name = attribute.name.toLowerCase()
    const value = attribute.value.trim()
    if (attribute.namespaceURI === xmlnsNamespace) {
      if (name === "xmlns" && value === svgNamespace) continue
      if (name === "xmlns:xlink" && value === xlinkNamespace) continue
      return false
    }
    if (attribute.namespaceURI) return false
    if (name === "id" && ids.get(value) === 1) continue
    if (
      name === "class" &&
      value.length <= 256 &&
      /^(?:[A-Za-z_][A-Za-z0-9_-]*)(?:\s+[A-Za-z_][A-Za-z0-9_-]*)*$/.test(value)
    )
      continue
    if (name === "style" && isSafeRootDeclarations(value)) continue
    if (name === "viewbox" && isSafeViewBox(value)) continue
    if (name === "width" && (value === "100%" || isBoundedSvgLength(value))) continue
    if (name === "height" && isBoundedSvgLength(value)) continue
    if (name === "preserveaspectratio" && isSafePreserveAspectRatio(value)) continue
    if (name === "role" && value === "graphics-document document") continue
    if (
      name === "aria-roledescription" &&
      value.length > 0 &&
      value.length <= 128 &&
      !/[\u0000-\u001f\u007f]/.test(value)
    )
      continue
    if (name === "aria-label" && value.length > 0 && value.length <= 1_000 && !/[\u0000-\u001f\u007f]/.test(value))
      continue
    if (ariaSingleReferenceAttributes.has(name) && isLocalIDToken(value, ids)) continue
    if (ariaReferenceListAttributes.has(name) && hasOnlyLocalIDTokens(value, ids)) continue
    return false
  }
  return true
}

function isSafeViewBox(value: string) {
  const parts = value.trim().split(/[\s,]+/)
  if (parts.length !== 4 || !parts.every(isPlainNumber)) return false
  const [x, y, width, height] = parts.map(Number)
  return (
    Math.abs(x) <= 20_000 && Math.abs(y) <= 20_000 && width > 0 && width <= 20_000 && height > 0 && height <= 20_000
  )
}

function isBoundedSvgLength(value: string) {
  const match = value.match(/^((?:\d+(?:\.\d*)?|\.\d+))(?:px)?$/i)
  if (!match) return false
  const length = Number(match[1])
  return length > 0 && length <= 20_000
}

function isPlainNumber(value: string) {
  return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)
}

function isSafePreserveAspectRatio(value: string) {
  return /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/.test(value)
}

function isSafeFilterGraph(root: Element) {
  const elements = Array.from(root.querySelectorAll("*"))
  const filters = elements.filter((element) => element.localName.toLowerCase() === "filter")
  for (const primitive of elements.filter((element) => element.localName.toLowerCase().startsWith("fe"))) {
    if (primitive.parentElement?.localName.toLowerCase() !== "filter") return false
  }
  for (const filter of filters) {
    if (filter.parentElement?.localName.toLowerCase() !== "defs") return false
    if (!filter.id) return false
    for (const attribute of filter.attributes) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()
      if (name === "id") continue
      if ((name === "width" || name === "height") && isBoundedFilterPercentage(value, 0, 200)) continue
      if ((name === "x" || name === "y") && isBoundedFilterPercentage(value, -100, 100)) continue
      if (name === "filterunits" && value === "objectBoundingBox") continue
      return false
    }

    const primitives = Array.from(filter.children)
    if (primitives.length === 0 || primitives.length > 4) return false
    for (const primitive of primitives) {
      if (primitive.localName.toLowerCase() !== "fedropshadow") return false
      if (!isSafeDropShadow(primitive)) return false
    }
  }
  return true
}

function isSafeDropShadow(element: Element) {
  for (const attribute of element.attributes) {
    const name = attribute.name.toLowerCase()
    const value = attribute.value.trim()
    if ((name === "dx" || name === "dy") && isBoundedNumber(value, -32, 32)) continue
    if (name === "stddeviation" && isBoundedNumberList(value, 0, 32, 2)) continue
    if (name === "flood-opacity" && isBoundedNumber(value, 0, 1)) continue
    if (name === "flood-color" && /^(?:#000000|#ffffff)$/i.test(value)) continue
    return false
  }
  return element.children.length === 0
}

function isBoundedFilterPercentage(value: string, minimum: number, maximum: number) {
  const match = value.match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+))%$/)
  if (!match) return false
  const number = Number(match[1])
  return number >= minimum && number <= maximum
}

function isBoundedNumber(value: string, minimum: number, maximum: number) {
  if (!isPlainNumber(value)) return false
  const number = Number(value)
  return number >= minimum && number <= maximum
}

function isBoundedNumberList(value: string, minimum: number, maximum: number, maximumItems: number) {
  const numbers = value.split(/[\s,]+/)
  return (
    numbers.length > 0 &&
    numbers.length <= maximumItems &&
    numbers.every((number) => isBoundedNumber(number, minimum, maximum))
  )
}

function svgIDs(root: Element) {
  const ids = new Map<string, number>()
  for (const element of [root, ...root.querySelectorAll("*")]) {
    const id = element.getAttribute("id")
    if (!id) continue
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) return
    ids.set(id, (ids.get(id) ?? 0) + 1)
  }
  if ([...ids.values()].some((count) => count !== 1)) return
  return ids
}

function isSafeCssDeclarations(css: string, ids: Map<string, number>, variables: CssVariableContext) {
  const declarations = cssDeclarations(css)
  if (!declarations) return false
  return declarations.every(({ property, value }) => {
    if (!cssProperties.has(property)) return false
    if (!isSafeLayoutDeclaration(property, value)) return false
    if (/\bvar\s*\(/i.test(value)) {
      if (!variables.fontFamily) return false
      if (property !== "font-family" || !/^var\s*\(\s*--mermaid-font-family\s*\)$/i.test(value)) return false
    }
    if (property === "--mermaid-font-family" && !isTrustedFontFamily(value)) return false
    if ((property === "font-family" || property === "--mermaid-font-family") && isSafeCssValue(value, ids, true))
      return true
    return isSafeCssValue(value, ids, false)
  })
}

function isSafeStylesheet(
  css: string,
  rootID: string,
  ids: Map<string, number>,
  variables: CssVariableContext,
  keyframeNamespace?: string,
) {
  if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(rootID)) return false
  if (ids.get(rootID) !== 1) return false
  if (/\\|\/\*|\*\//.test(css)) return false

  const blocks = cssBlocks(css)
  if (!blocks) return false
  return blocks.every((block) => {
    const keyframeName = keyframeNamespace
      ? block.header.match(/^@keyframes\s+([A-Za-z][A-Za-z0-9_-]*)$/i)?.[1]
      : block.header.match(/^@keyframes\s+(edge-animation-frame|dash)$/i)?.[1]
    const keyframes = keyframeNamespace
      ? keyframeName === `${keyframeNamespace}-edge-animation-frame` || keyframeName === `${keyframeNamespace}-dash`
      : !!keyframeName
    if (keyframes) return isSafeKeyframes(block.body, ids, variables)
    if (block.header.startsWith("@")) return false
    const selectors = block.header.split(",").map((selector) => selector.trim())
    const kinds = selectors.map((selector) => scopedSelectorKind(selector, rootID))
    if (kinds.some((kind) => kind === undefined)) return false
    if (kinds.includes("root")) return isSafeRootDeclarations(block.body)
    return isSafeCssDeclarations(block.body, ids, variables)
  })
}

function isSafeKeyframes(css: string, ids: Map<string, number>, variables: CssVariableContext) {
  const blocks = cssBlocks(css)
  if (!blocks) return false
  return blocks.every(
    (block) =>
      /^(?:(?:from|to|\d+(?:\.\d+)?%)\s*,?\s*)+$/i.test(block.header) &&
      isSafeCssDeclarations(block.body, ids, variables),
  )
}

function scopedSelectorKind(selector: string, rootID: string): "root" | "descendant" | undefined {
  const prefix = `#${rootID}`
  const value = selector.trim()
  if (!value.startsWith(prefix)) return
  const rest = value.slice(prefix.length)
  if (!rest) return "root"
  if (!/^(?:\s+|>)/.test(rest)) return
  const descendant = rest.trimStart()
  if (/^[+~]/.test(descendant)) return
  if (descendant.startsWith(">") && !descendant.slice(1).trim()) return
  return "descendant"
}

function isSafeLayoutDeclaration(property: string, value: string) {
  if (property === "position" && !/^(?:absolute|relative|static)(?:\s*!important)?$/i.test(value.trim())) return false
  if (/[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:dvh|dvw|lvh|lvw|svh|svw|vb|vi|vh|vw|vmax|vmin)\b/i.test(value)) return false
  if (property.startsWith("inset")) return false
  if (property !== "z-index") return true
  if (value.trim().toLowerCase() === "auto") return true
  const index = Number(value.trim())
  return Number.isInteger(index) && index >= -1 && index <= 100
}

function isSafeRootDeclarations(css: string) {
  const declarations = cssDeclarations(css)
  if (!declarations) return false
  return declarations.every(({ property, value }) => {
    if (property === "--mermaid-font-family" || property === "font-family") return isTrustedFontFamily(value)
    if (property === "font-size") return value.trim().toLowerCase() === "16px"
    if (property === "fill") return /^(?:#18181b|#333|#fafafa)$/i.test(value.trim())
    if (property !== "max-width") return false
    const width = value.trim().match(/^(\d+(?:\.\d+)?)px$/i)
    return !!width && Number(width[1]) > 0 && Number(width[1]) <= 20_000
  })
}

function cssDeclarations(css: string) {
  if (/[{}@]/.test(css)) return
  const parts = splitCss(css, ";")
  if (!parts) return
  const declarations: Array<{ property: string; value: string }> = []
  for (const part of parts) {
    const value = part.trim()
    if (!value) continue
    const match = value.match(/^([-A-Za-z][\w-]*)\s*:\s*(.+)$/s)
    if (!match) return
    declarations.push({ property: match[1].toLowerCase(), value: match[2].trim() })
  }
  return declarations
}

function isSafeCssValue(value: string, ids: Map<string, number>, allowStrings: boolean) {
  if (!value || /\\|\/\*|\*\/|[{}@]/.test(value)) return false
  if (/javascript\s*:|vbscript\s*:|data\s*:|https?\s*:|file\s*:|blob\s*:|\/\//i.test(compact(value))) return false
  if (!allowStrings && /["']/.test(value)) return false
  if (!hasOnlyLocalUrls(value, ids)) return false

  let quote = ""
  let depth = 0
  for (let index = 0; index < value.length; index++) {
    const character = value[index]
    if (quote) {
      if (character === quote) quote = ""
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === ")") {
      depth--
      if (depth < 0) return false
      continue
    }
    if (character !== "(") continue
    depth++
    let end = index - 1
    while (/\s/.test(value[end] ?? "")) end--
    let start = end
    while (/[\w-]/.test(value[start] ?? "")) start--
    const name = value.slice(start + 1, end + 1).toLowerCase()
    if (!cssFunctions.has(name)) return false
  }
  return !quote && depth === 0
}

function splitCss(value: string, separator: string) {
  const parts: string[] = []
  let quote = ""
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index++) {
    const character = value[index]
    if (quote) {
      if (character === quote) quote = ""
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === "(") depth++
    if (character === ")") depth--
    if (depth < 0) return
    if (character !== separator || depth !== 0) continue
    parts.push(value.slice(start, index))
    start = index + 1
  }
  if (quote || depth !== 0) return
  parts.push(value.slice(start))
  return parts
}

function cssBlocks(css: string) {
  const blocks: Array<{ header: string; body: string }> = []
  let cursor = 0
  while (cursor < css.length) {
    while (/\s|;/.test(css[cursor] ?? "")) cursor++
    if (cursor >= css.length) break

    const open = findCssCharacter(css, cursor, "{")
    if (open < 0) return
    const close = findClosingBrace(css, open)
    if (close < 0) return
    const header = css.slice(cursor, open).trim()
    if (!header) return
    blocks.push({ header, body: css.slice(open + 1, close) })
    cursor = close + 1
  }
  return blocks
}

function findCssCharacter(css: string, start: number, target: string) {
  let quote = ""
  for (let index = start; index < css.length; index++) {
    const character = css[index]
    if (quote) {
      if (character === quote) quote = ""
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === target) return index
  }
  return -1
}

function findClosingBrace(css: string, open: number) {
  let depth = 0
  let quote = ""
  for (let index = open; index < css.length; index++) {
    const character = css[index]
    if (quote) {
      if (character === quote) quote = ""
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === "{") depth++
    if (character !== "}") continue
    depth--
    if (depth === 0) return index
  }
  return -1
}

function hasOnlyLocalUrls(value: string, ids: Map<string, number>) {
  let found = false
  const rest = value.replace(/\burl\s*\(\s*(["']?)(.*?)\1\s*\)/gis, (_match, _quote, url: string) => {
    found = true
    return isLocalFragment(url.trim(), ids) ? "" : "unsafe-url"
  })
  if (rest.includes("unsafe-url")) return false
  if (/\burl\s*\(/i.test(rest)) return false
  return found || !/\burl\s*\(/i.test(value)
}

function isLocalFragment(value: string, ids: Map<string, number>) {
  const match = value.match(/^#([A-Za-z_][A-Za-z0-9_-]*)$/)
  return !!match && ids.get(match[1]) === 1
}

function hasOnlyLocalIDTokens(value: string, ids: Map<string, number>) {
  const references = value.split(/\s+/).filter(Boolean)
  return references.length > 0 && references.every((reference) => ids.get(reference) === 1)
}

function isLocalIDToken(value: string, ids: Map<string, number>) {
  return !/\s/.test(value) && ids.get(value) === 1
}

function treeSignature(root: Element) {
  const visit = (node: Node): unknown => {
    if (node.nodeType === 1) {
      const element = node as Element
      const attributes = Array.from(element.attributes, (attribute) => [
        attribute.namespaceURI ?? "",
        attribute.localName,
      ]).sort((left, right) => left.join("\u0000").localeCompare(right.join("\u0000")))
      return [
        "element",
        element.namespaceURI ?? "",
        element.localName,
        attributes,
        Array.from(element.childNodes, visit),
      ]
    }
    return ["node", node.nodeType]
  }
  return JSON.stringify(visit(root))
}

function instantiate(template: MermaidSuccess): MermaidSuccess | undefined {
  const root = parseSvg(template.svg)
  if (!root) return
  const ids = svgIDs(root)
  if (!ids) return

  const namespace = uniqueNamespace([...ids.keys()])
  const replacements = new Map([...ids.keys()].map((id) => [id, `${namespace}-${id}`]))
  const keyframes = new Map<string, string>()
  for (const style of root.querySelectorAll("style")) {
    const blocks = cssBlocks(style.textContent ?? "")
    if (!blocks) return
    for (const block of blocks) {
      const match = block.header.match(/^@keyframes\s+(edge-animation-frame|dash)$/i)
      if (match) keyframes.set(match[1], `${namespace}-${match[1]}`)
    }
  }

  for (const element of [root, ...root.querySelectorAll("*")]) {
    const id = element.getAttribute("id")
    if (id) element.setAttribute("id", replacements.get(id) ?? id)
    if (element.localName.toLowerCase() === "style") {
      const rewritten = rewriteStylesheet(element.textContent ?? "", replacements, keyframes)
      if (!rewritten) return
      element.textContent = rewritten
    }

    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase()
      const localName = attribute.localName.toLowerCase()
      if (localName === "href" || name === "src") {
        const replacement = replacements.get(attribute.value.slice(1))
        if (!replacement) return
        attribute.value = `#${replacement}`
        continue
      }
      if (ariaSingleReferenceAttributes.has(name)) {
        const rewritten = replacements.get(attribute.value)
        if (!rewritten) return
        attribute.value = rewritten
        continue
      }
      if (ariaReferenceListAttributes.has(name)) {
        const rewritten = attribute.value
          .split(/\s+/)
          .filter(Boolean)
          .map((reference) => replacements.get(reference))
        if (rewritten.some((reference) => !reference)) return
        attribute.value = rewritten.join(" ")
        continue
      }
      if (name === "style") {
        const rewritten = rewriteDeclarations(attribute.value, replacements, keyframes)
        if (rewritten === undefined) return
        attribute.value = rewritten
        continue
      }
      attribute.value = rewriteLocalUrls(attribute.value, replacements)
    }
  }

  if (!isSafeSvg(root, namespace)) return
  return { ...template, svg: new XMLSerializer().serializeToString(root) }
}

function uniqueNamespace(ids: string[]) {
  while (true) {
    const namespace = `mermaid-instance-${(++instanceID).toString(36)}`
    if (typeof document === "undefined") return namespace
    if (!ids.some((id) => document.getElementById(`${namespace}-${id}`))) return namespace
  }
}

function rewriteStylesheet(css: string, ids: Map<string, string>, keyframes: Map<string, string>) {
  const blocks = cssBlocks(css)
  if (!blocks) return
  const rewritten: string[] = []
  for (const block of blocks) {
    const keyframe = block.header.match(/^@keyframes\s+(edge-animation-frame|dash)$/i)
    if (keyframe) {
      const frames = cssBlocks(block.body)
      const name = keyframes.get(keyframe[1])
      if (!frames || !name) return
      const body = frames.map((frame) => {
        const declarations = rewriteDeclarations(frame.body, ids, keyframes)
        return declarations === undefined ? undefined : `${frame.header}{${declarations}}`
      })
      if (body.some((frame) => frame === undefined)) return
      rewritten.push(`@keyframes ${name}{${body.join("")}}`)
      continue
    }

    const header = block.header.replace(/#([A-Za-z_][A-Za-z0-9_-]*)/g, (match, id: string) => {
      const replacement = ids.get(id)
      return replacement ? `#${replacement}` : match
    })
    const body = rewriteDeclarations(block.body, ids, keyframes)
    if (body === undefined) return
    rewritten.push(`${header}{${body}}`)
  }
  return rewritten.join("")
}

function rewriteDeclarations(css: string, ids: Map<string, string>, keyframes: Map<string, string>) {
  const declarations = cssDeclarations(css)
  if (!declarations) return
  return declarations
    .map(({ property, value }) => {
      let rewritten = rewriteLocalUrls(value, ids)
      if (property === "animation" || property === "animation-name") {
        for (const [name, replacement] of keyframes) {
          rewritten = rewritten.replace(
            new RegExp(`(^|[^A-Za-z0-9_-])${name}(?=$|[^A-Za-z0-9_-])`, "g"),
            `$1${replacement}`,
          )
        }
      }
      return `${property}:${rewritten}`
    })
    .join(";")
}

function rewriteLocalUrls(value: string, ids: Map<string, string>) {
  return value.replace(/\burl\s*\(\s*(["']?)#([A-Za-z_][A-Za-z0-9_-]*)\1\s*\)/gi, (match, _quote, id: string) => {
    const replacement = ids.get(id)
    return replacement ? `url(#${replacement})` : match
  })
}

function compact(value: string) {
  return value.replace(/[\u0000-\u0020\u007f]+/g, "").toLowerCase()
}

function touchCache(key: string, result: MermaidSuccess) {
  cache.delete(key)
  cache.set(key, result)
  if (cache.size <= maxCacheEntries) return
  const oldest = cache.keys().next().value
  if (oldest) cache.delete(oldest)
}

function classifyFailure(error: unknown): MermaidFailure {
  const message = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : String(error).toLowerCase()
  if (/max(?:imum)?(?: text| number of)? edges?|edge limit|too many edges|text size|maximum allowed size/.test(message))
    return "limit"
  if (/parse|syntax|lexical|unknown diagram|no diagram type|expecting/.test(message)) return "syntax"
  return "runtime"
}
