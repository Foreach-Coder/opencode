// This standalone source is embedded verbatim, with Marked supplied by the HTML shell.
// Keep it independent of the app, browser storage and remote resources.
function renderSessionExport(marked) {
  const root = document.getElementById("session-root")
  const data = JSON.parse(document.getElementById("session-data").textContent)
  const metadata = JSON.parse(document.getElementById("export-metadata").textContent)
  const mermaidData = JSON.parse(document.getElementById("mermaid-snapshots").textContent)
  const labels = metadata.labels
  const mermaidSnapshots = new Map()
  for (const snapshot of Array.isArray(mermaidData.snapshots) ? mermaidData.snapshots : []) {
    if (!snapshot || typeof snapshot.key !== "string" || typeof snapshot.source !== "string") continue
    const records = mermaidSnapshots.get(snapshot.key) || []
    records.push(snapshot)
    mermaidSnapshots.set(snapshot.key, records)
  }
  const status = element("p", "", "feedback")
  status.setAttribute("role", "status")
  let mermaidInstance = 0
  const ariaSingleReferenceAttributes = new Set(["aria-activedescendant", "aria-errormessage"])
  const ariaReferenceListAttributes = new Set([
    "aria-controls",
    "aria-describedby",
    "aria-details",
    "aria-flowto",
    "aria-labelledby",
    "aria-owns",
  ])

  function element(tag, text, className) {
    const node = document.createElement(tag)
    if (text !== undefined) node.textContent = text
    if (className) node.className = className
    return node
  }

  function date(value) {
    if (!Number.isFinite(value)) return ""
    return new Date(value).toLocaleString(document.documentElement.lang)
  }

  function imageUrl(value) {
    return typeof value === "string" && /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z\d+/=\s]+$/i.test(value)
  }

  function linkUrl(value) {
    return /^(?:https?:\/\/|mailto:)[^\s\u0000-\u001f\u007f]+$/i.test(value)
  }

  function checksum(value) {
    if (!value) return "0"
    let hash = 0x811c9dc5
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(36)
  }

  function mermaidKey(source) {
    return `${mermaidData.mermaidVersion}:light:${source.length}:${checksum(source)}`
  }

  function safeMermaidSvg(source) {
    if (typeof source !== "string") return
    const parsed = new DOMParser().parseFromString(source, "image/svg+xml")
    if (parsed.querySelector("parsererror")) return
    const svg = parsed.documentElement
    if (svg.localName !== "svg" || svg.namespaceURI !== "http://www.w3.org/2000/svg") return
    const forbidden = new Set([
      "a",
      "animate",
      "animatecolor",
      "animatemotion",
      "animatetransform",
      "audio",
      "discard",
      "embed",
      "foreignobject",
      "handler",
      "iframe",
      "object",
      "script",
      "set",
      "video",
    ])
    const ids = new Map()
    for (const node of svg.querySelectorAll("*")) {
      if (node.namespaceURI !== "http://www.w3.org/2000/svg" || forbidden.has(node.localName.toLowerCase())) return
    }
    for (const node of [svg, ...svg.querySelectorAll("*")]) {
      const id = node.getAttribute("id")
      if (id) ids.set(id, (ids.get(id) || 0) + 1)
    }
    if ([...ids.values()].some((count) => count !== 1)) return
    for (const node of [svg, ...svg.querySelectorAll("*")]) {
      for (const attribute of node.attributes) {
        const name = attribute.name.toLowerCase()
        const value = attribute.value
        if (name.startsWith("on") || attribute.localName.toLowerCase() === "base") return
        if (name === "xmlns" && value === "http://www.w3.org/2000/svg") continue
        if (name === "xmlns:xlink" && value === "http://www.w3.org/1999/xlink") continue
        if (name === "href" || name === "xlink:href" || name === "src") {
          if (!/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(value) || ids.get(value.slice(1)) !== 1) return
        }
        if (!safeLocalUrls(value, ids)) return
      }
      if (node.localName === "style" && !safeLocalUrls(node.textContent || "", ids)) return
    }
    return svg
  }

  function safeLocalUrls(value, ids) {
    if (!/url\s*\(/i.test(value)) return !/(?:javascript:|data:|https?:|\/\/)/i.test(value)
    let count = 0
    const stripped = value.replace(/url\s*\(\s*(["']?)#([A-Za-z_][A-Za-z0-9_.:-]*)\1\s*\)/gi, (_match, _quote, id) => {
      if (ids.get(id) !== 1) return "__invalid_mermaid_url__"
      count++
      return ""
    })
    return count > 0 && !/url\s*\(|__invalid_mermaid_url__|(?:javascript:|data:|https?:|\/\/)/i.test(stripped)
  }

  function mermaidCard(source) {
    const records = mermaidSnapshots.get(mermaidKey(source))
    const snapshot = records?.find((record) => record.source === source)
    if (!snapshot || snapshot.failure || typeof snapshot.svg !== "string") return
    const safe = safeMermaidSvg(snapshot.svg)
    const svg = safe && instantiateMermaidSvg(safe)
    if (!svg) return
    const title =
      typeof snapshot.title === "string" && snapshot.title.trim() ? snapshot.title.trim() : labels.mermaidDiagram
    const card = element("figure", undefined, "mermaid-card")
    card.setAttribute("aria-label", title)
    const toolbar = element("div", undefined, "mermaid-toolbar")
    const canvas = element("div", undefined, "mermaid-canvas")
    const diagram = document.importNode(svg, true)
    const width = intrinsicSvgWidth(diagram)
    if (width) diagram.style.width = `${Math.ceil(width)}px`
    mermaidControls(toolbar, canvas, diagram, width)
    const button = element("button", labels.copyMermaidSource)
    button.type = "button"
    button.addEventListener("click", () => copy(source))
    toolbar.append(button)
    canvas.append(diagram)
    card.append(toolbar, canvas)
    return card
  }

  function mermaidControls(toolbar, canvas, diagram, width) {
    const minimum = 0.5
    const maximum = 2
    const step = 0.25
    let scale = 1

    const zoomOut = element("button", "−")
    zoomOut.type = "button"
    zoomOut.className = "mermaid-zoom-out"
    zoomOut.setAttribute("aria-label", labels.zoomOut)
    zoomOut.title = labels.zoomOut
    const resetZoom = element("button")
    resetZoom.type = "button"
    resetZoom.className = "mermaid-zoom-reset"
    const zoomIn = element("button", "+")
    zoomIn.type = "button"
    zoomIn.className = "mermaid-zoom-in"
    zoomIn.setAttribute("aria-label", labels.zoomIn)
    zoomIn.title = labels.zoomIn

    const update = () => {
      const percentage = `${Math.round(scale * 100)}%`
      diagram.style.width = width ? `${Math.ceil(width * scale)}px` : percentage
      diagram.style.minWidth = percentage
      diagram.style.maxWidth = "none"
      resetZoom.textContent = percentage
      resetZoom.setAttribute("aria-label", `${labels.resetZoom} (${percentage})`)
      resetZoom.title = `${labels.resetZoom} (${percentage})`
      zoomOut.disabled = scale <= minimum
      zoomIn.disabled = scale >= maximum
    }
    const setScale = (next) => {
      scale = Math.min(maximum, Math.max(minimum, next))
      update()
    }
    zoomOut.addEventListener("click", () => setScale(scale - step))
    zoomIn.addEventListener("click", () => setScale(scale + step))
    resetZoom.addEventListener("click", () => {
      setScale(1)
      canvas.scrollLeft = 0
      canvas.scrollTop = 0
    })

    let drag
    canvas.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch" || event.button !== 0) return
      if (canvas.scrollWidth <= canvas.clientWidth && canvas.scrollHeight <= canvas.clientHeight) return
      drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: canvas.scrollLeft,
        top: canvas.scrollTop,
      }
      canvas.dataset.dragging = "true"
      canvas.setPointerCapture?.(event.pointerId)
      event.preventDefault()
    })
    canvas.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return
      canvas.scrollLeft = drag.left - (event.clientX - drag.x)
      canvas.scrollTop = drag.top - (event.clientY - drag.y)
    })
    const stop = (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return
      drag = undefined
      delete canvas.dataset.dragging
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    }
    canvas.addEventListener("pointerup", stop)
    canvas.addEventListener("pointercancel", stop)
    canvas.addEventListener("lostpointercapture", stop)

    toolbar.append(zoomOut, resetZoom, zoomIn)
    update()
  }

  function instantiateMermaidSvg(svg) {
    const ids = new Map()
    for (const node of [svg, ...svg.querySelectorAll("[id]")]) {
      const id = node.getAttribute("id")
      if (id) ids.set(id, (ids.get(id) || 0) + 1)
    }
    if ([...ids.values()].some((count) => count !== 1)) return
    const namespace = uniqueMermaidNamespace([...ids.keys()])
    if (!namespace) return
    const replacements = new Map([...ids.keys()].map((id) => [id, `${namespace}-${id}`]))
    const keyframes = new Map()
    for (const style of svg.querySelectorAll("style")) {
      const blocks = cssBlocks(style.textContent || "")
      if (!blocks) return
      for (const block of blocks) {
        const keyframe = block.header.match(/^@keyframes\s+([A-Za-z_][A-Za-z0-9_-]*)$/i)
        if (keyframe) keyframes.set(keyframe[1], `${namespace}-${keyframe[1]}`)
      }
    }

    for (const node of [svg, ...svg.querySelectorAll("*")]) {
      const id = node.getAttribute("id")
      if (id) node.setAttribute("id", replacements.get(id) || id)
      if (node.localName === "style") {
        const stylesheet = rewriteStylesheet(node.textContent || "", replacements, keyframes)
        if (stylesheet === undefined) return
        node.textContent = stylesheet
      }
      for (const attribute of node.attributes) {
        const name = attribute.name.toLowerCase()
        const localName = attribute.localName.toLowerCase()
        if (localName === "href" || name === "src") {
          const replacement = replacements.get(attribute.value.slice(1))
          if (!replacement) return
          attribute.value = `#${replacement}`
          continue
        }
        if (ariaSingleReferenceAttributes.has(name)) {
          const replacement = replacements.get(attribute.value)
          if (!replacement) return
          attribute.value = replacement
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
          const declarations = rewriteDeclarations(attribute.value, replacements, keyframes)
          if (declarations === undefined) return
          attribute.value = declarations
          continue
        }
        attribute.value = rewriteLocalUrls(attribute.value, replacements)
      }
    }

    return safeMermaidSvg(new XMLSerializer().serializeToString(svg))
  }

  function uniqueMermaidNamespace(ids) {
    for (let attempt = 0; attempt < 1_000; attempt++) {
      const namespace = `codeagent-mermaid-${(++mermaidInstance).toString(36)}`
      if (!ids.some((id) => document.getElementById(`${namespace}-${id}`))) return namespace
    }
  }

  function rewriteStylesheet(css, ids, keyframes) {
    const blocks = cssBlocks(css)
    if (!blocks) return
    const rewritten = []
    for (const block of blocks) {
      const keyframe = block.header.match(/^@keyframes\s+([A-Za-z_][A-Za-z0-9_-]*)$/i)
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
      const header = block.header.replace(/#([A-Za-z_][A-Za-z0-9_-]*)/g, (match, id) => {
        const replacement = ids.get(id)
        return replacement ? `#${replacement}` : match
      })
      const declarations = rewriteDeclarations(block.body, ids, keyframes)
      if (declarations === undefined) return
      rewritten.push(`${header}{${declarations}}`)
    }
    return rewritten.join("")
  }

  function rewriteDeclarations(css, ids, keyframes) {
    const declarations = cssDeclarations(css)
    if (!declarations) return
    return declarations
      .map(({ property, value }) => {
        let rewritten = rewriteLocalUrls(value, ids)
        if (property === "animation" || property === "animation-name") {
          for (const [name, replacement] of keyframes)
            rewritten = rewritten.replace(
              new RegExp(`(^|[^A-Za-z0-9_-])${name}(?=$|[^A-Za-z0-9_-])`, "g"),
              `$1${replacement}`,
            )
        }
        return `${property}:${rewritten}`
      })
      .join(";")
  }

  function rewriteLocalUrls(value, ids) {
    return value.replace(/\burl\s*\(\s*(["']?)#([A-Za-z_][A-Za-z0-9_.:-]*)\1\s*\)/gi, (match, _quote, id) => {
      const replacement = ids.get(id)
      return replacement ? `url(#${replacement})` : match
    })
  }

  function cssDeclarations(css) {
    if (/[{}@]/.test(css)) return
    const parts = splitCss(css, ";")
    if (!parts) return
    const declarations = []
    for (const part of parts) {
      const value = part.trim()
      if (!value) continue
      const match = value.match(/^([-A-Za-z][\w-]*)\s*:\s*(.+)$/s)
      if (!match) return
      declarations.push({ property: match[1].toLowerCase(), value: match[2].trim() })
    }
    return declarations
  }

  function splitCss(value, separator) {
    const parts = []
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

  function cssBlocks(css) {
    const blocks = []
    let cursor = 0
    while (cursor < css.length) {
      while (/\s|;/.test(css[cursor] || "")) cursor++
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

  function findCssCharacter(css, start, target) {
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

  function findClosingBrace(css, open) {
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

  function intrinsicSvgWidth(svg) {
    const viewBox = svg
      .getAttribute("viewBox")
      ?.trim()
      .split(/[\s,]+/)
    const viewBoxWidth = viewBox?.length === 4 ? Number(viewBox[2]) : Number.NaN
    if (Number.isFinite(viewBoxWidth) && viewBoxWidth > 0 && viewBoxWidth <= 20000) return viewBoxWidth
    const width = svg
      .getAttribute("width")
      ?.trim()
      .match(/^(\d+(?:\.\d*)?|\.\d+)(?:px)?$/i)
    const intrinsic = width ? Number(width[1]) : Number.NaN
    if (Number.isFinite(intrinsic) && intrinsic > 0 && intrinsic <= 20000) return intrinsic
  }

  // Rebuild an inert parse into new DOM nodes. Never copy arbitrary attributes or
  // attach nodes from the untrusted document, including SVG and custom elements.
  function markdown(text, references = []) {
    const chars = Array.from(text)
    // Offsets are Unicode code points from the shared annotation parser. Replace
    // backwards so earlier offsets remain valid; code and quoted examples stay literal.
    for (const reference of references.slice().reverse()) {
      chars.splice(
        reference.start,
        reference.end - reference.start,
        `[${labels.annotation.replace("{{index}}", reference.index)}](${reference.href})`,
      )
    }
    const source = chars.join("")
    const tokens = marked.lexer(source, { gfm: true })
    const codeTokens = []
    marked.walkTokens(tokens, (token) => {
      if (token.type === "code") codeTokens.push(token)
    })
    const template = document.createElement("template")
    template.innerHTML = marked.parser(tokens, { async: false, gfm: true })
    template.content.querySelectorAll("pre > code").forEach((code, index) => {
      const token = codeTokens[index]
      const language = token?.lang?.trim().split(/\s+/, 1)[0]?.toLowerCase()
      if (language === "mermaid" && markdownFenceClosed(token.raw)) code.dataset.mermaid = ""
    })
    const allowed = new Set([
      "P",
      "BR",
      "HR",
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
      "STRONG",
      "EM",
      "DEL",
      "S",
      "BLOCKQUOTE",
      "UL",
      "OL",
      "LI",
      "PRE",
      "CODE",
      "TABLE",
      "THEAD",
      "TBODY",
      "TR",
      "TH",
      "TD",
      "A",
    ])
    function clean(node) {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent)
      if (node.nodeType !== Node.ELEMENT_NODE) return document.createTextNode("")
      if (node.tagName === "IMG") {
        const src = node.getAttribute("src") || ""
        const alt = node.getAttribute("alt") || labels.attachment
        if (!imageUrl(src)) return element("span", `${alt} · ${labels.unavailable}`, "attachment-note")
        const img = element("img")
        img.src = src
        img.alt = alt
        return img
      }
      if (node.tagName === "INPUT" && node.getAttribute("type") === "checkbox") {
        const checkbox = element("input")
        checkbox.type = "checkbox"
        checkbox.disabled = true
        checkbox.checked = node.hasAttribute("checked")
        return checkbox
      }
      if (!allowed.has(node.tagName)) return document.createTextNode(node.textContent)
      const result = element(node.tagName.toLowerCase())
      if (node.tagName === "CODE") {
        if (node.hasAttribute("data-mermaid")) result.dataset.mermaid = ""
      }
      if (node.tagName === "A") {
        const href = node.getAttribute("href") || ""
        if (references.some((reference) => reference.href === href)) {
          result.setAttribute("href", href)
          result.className = "annotation-reference"
        }
        if (linkUrl(href)) {
          result.href = href
          result.target = "_blank"
          result.rel = "noopener noreferrer"
        }
      }
      if (node.tagName === "OL" && /^\d+$/.test(node.getAttribute("start") || ""))
        result.start = Number(node.getAttribute("start"))
      node.childNodes.forEach((child) => result.append(clean(child)))
      return result
    }
    const body = element("div", undefined, "markdown")
    template.content.childNodes.forEach((node) => body.append(clean(node)))
    body.querySelectorAll("table").forEach((table) => {
      const scroll = element("div", undefined, "table-scroll")
      table.replaceWith(scroll)
      scroll.append(table)
    })
    body.querySelectorAll("pre").forEach((pre) => {
      const text = pre.textContent
      const mermaid = pre.querySelector(":scope > code[data-mermaid]")
      if (mermaid) {
        const card = mermaidCard(text)
        if (card) {
          pre.replaceWith(card)
          return
        }
      }
      const block = element("div", undefined, "code-block")
      const toolbar = element("div", undefined, "code-toolbar")
      const button = element("button", labels.copy)
      button.type = "button"
      button.addEventListener("click", () => copy(text))
      if (mermaid) toolbar.prepend(element("span", labels.mermaidFailed, "mermaid-failed"))
      toolbar.append(button)
      pre.replaceWith(block)
      block.append(toolbar, pre)
    })
    return body
  }

  function markdownFenceClosed(raw) {
    const mark = raw.match(/^[ \t]{0,3}(`{3,}|~{3,})/)?.[1]
    if (!mark) return false
    const last = raw.trimEnd().split("\n").at(-1)?.trim() || ""
    return new RegExp(`^[\\t ]{0,3}${mark[0]}{${mark.length},}[\\t ]*$`).test(last)
  }

  async function copy(text) {
    const dialog = document.querySelector("dialog[open]")
    const feedback = dialog?.querySelector('[role="status"]') || status
    const copied = navigator.clipboard
      ? await navigator.clipboard.writeText(text).then(
          () => true,
          () => false,
        )
      : false
    if (copied) {
      feedback.textContent = labels.copied
      return
    }
    const focused = document.activeElement
    const field = element("textarea", text, "clipboard-field")
    ;(dialog || document.body).append(field)
    field.select()
    try {
      feedback.textContent = document.execCommand("copy") ? labels.copied : labels.copyFailed
    } catch {
      feedback.textContent = labels.copyFailed
    } finally {
      field.remove()
      if (focused instanceof HTMLElement) focused.focus({ preventScroll: true })
    }
  }

  function details(title, content, state) {
    const box = element("details", undefined, "process")
    const summary = element("summary", title)
    if (state) summary.append(element("span", labels[state] || state, `state ${state === "error" ? "error" : ""}`))
    const body = element("div", undefined, "process-body")
    body.append(content)
    box.append(summary, body)
    return box
  }

  function toolGroup(states) {
    const box = element("details", undefined, "process tool-group")
    const title = element("span")
    const state = element("span", undefined, "state")
    const summary = element("summary")
    const body = element("div", undefined, "tool-group-body")
    summary.append(title, state)
    box.append(summary, body)
    return { box, title, state, body, states }
  }

  function updateToolGroup(group) {
    const status = group.states.includes("error")
      ? "error"
      : group.states.includes("running")
        ? "running"
        : group.states.every((state) => state === "completed")
          ? "completed"
          : "pending"
    group.title.textContent = labels.toolGroup.replace("{{count}}", group.states.length)
    group.state.textContent = labels[status] || status
    group.state.className = `state ${status === "error" ? "error" : ""}`
  }

  function attachment(part) {
    const name = part.filename || labels.attachment
    const box = element("figure", undefined, "attachment")
    if (imageUrl(part.url)) {
      const img = element("img")
      img.src = part.url
      img.alt = name
      box.append(img)
    }
    box.append(element("figcaption", name))
    if (!imageUrl(part.url)) box.append(element("p", labels.unavailable, "muted"))
    return box
  }

  function questionSnapshot(part) {
    const questions = part.type === "tool" && part.tool === "question" && part.state.input?.questions
    if (
      !Array.isArray(questions) ||
      !questions.length ||
      !questions.every((question) => question && typeof question.question === "string")
    )
      return undefined
    return questions.map((question, index) => {
      const recorded = part.state.status === "completed" && part.state.metadata?.answers?.[index]
      const answer =
        Array.isArray(recorded) && recorded.every((value) => typeof value === "string") ? recorded : undefined
      return { question, answer }
    })
  }

  function questionView(snapshot, state, content) {
    const box = element("div", undefined, "question-tool")
    const heading = element("div", undefined, "question-heading")
    heading.append(element("strong", labels.questions), element("span", labels[state.status] || state.status, "state"))
    box.append(heading)
    for (const { question, answer } of snapshot) {
      const card = element("section", undefined, "question-card")
      if (typeof question.header === "string") card.append(element("p", question.header, "muted"))
      card.append(element("h3", question.question))
      const options = element("ul", undefined, "question-options")
      for (const option of Array.isArray(question.options) ? question.options : []) {
        if (!option || typeof option.label !== "string") continue
        const selected = answer?.includes(option.label)
        const item = element("li", undefined, `question-option${selected ? " selected" : ""}`)
        item.append(element("strong", option.label))
        if (selected) item.append(element("span", labels.selected, "selected-label"))
        if (typeof option.description === "string") item.append(element("p", option.description))
        options.append(item)
      }
      if (options.childNodes.length) card.append(options)
      if (answer) {
        const response = element("section", undefined, "question-answer")
        response.append(element("strong", labels.answer))
        for (const value of answer.length ? answer : [labels.noAnswer]) response.append(element("p", value))
        card.append(response)
      }
      if (!answer)
        card.append(
          element(
            "p",
            state.status === "pending" || state.status === "running" ? labels.awaitingAnswer : labels.answerUnavailable,
            "muted",
          ),
        )
      box.append(card)
    }
    if (state.error) box.append(element("p", state.error, "error"))
    box.append(details(labels.rawInputOutput, content))
    return box
  }

  function subagentView(state, content) {
    // Only unwrap the exact envelope produced by task. Preserve all other output
    // as safe Markdown, and keep the complete source in the raw data disclosure.
    const output = typeof state.output === "string" ? state.output : ""
    const envelope = output.match(
      /^<task id="[^"\r\n]+" state="(running|completed|error)">\r?\n(?:<summary>[^\r\n]*<\/summary>\r?\n)?<(task_result|task_error)>\r?\n([\s\S]*)\r?\n<\/\2>\r?\n<\/task>$/,
    )
    const background = state.metadata?.background === true || state.input?.background === true
    const snapshotStatus =
      state.status === "completed" ? envelope?.[1] || (background ? "running" : state.status) : state.status
    const title =
      typeof state.input?.description === "string" ? state.input.description : state.title || labels.subagent
    const box = element("section", undefined, "subagent-card")
    box.setAttribute("aria-label", title)
    const trigger = element("button", undefined, "subagent-trigger")
    trigger.type = "button"
    trigger.setAttribute("aria-label", labels.viewTask.replace("{{title}}", title))
    trigger.setAttribute("aria-haspopup", "dialog")
    const heading = element("span", undefined, "subagent-heading")
    heading.append(
      element("strong", labels.subagent),
      element("span", labels[snapshotStatus] || snapshotStatus, `state ${snapshotStatus === "error" ? "error" : ""}`),
    )
    if (background) heading.append(element("span", labels.background, "muted"))
    trigger.append(heading, element("strong", title, "subagent-title"))
    if (typeof state.input?.subagent_type === "string")
      trigger.append(element("span", state.input.subagent_type, "subagent-type"))
    trigger.append(element("span", labels.viewDetails, "subagent-hint"))
    const dialog = element("dialog", undefined, "subagent-dialog")
    dialog.setAttribute("aria-label", title)
    const toolbar = element("div", undefined, "subagent-dialog-header")
    const close = element("button", labels.close)
    close.type = "button"
    close.autofocus = true
    close.addEventListener("click", () => dialog.close())
    toolbar.append(element("h2", title), close)
    const body = element("div", undefined, "subagent-dialog-body")
    if (typeof state.input?.prompt === "string") {
      const prompt = element("div", undefined, "subagent-prompt")
      prompt.append(element("h4", labels.delegation), element("div", state.input.prompt, "user-text"))
      body.append(prompt)
    }
    const result = element("div", undefined, "subagent-result")
    result.append(element("h4", labels.taskResult))
    if (output) result.append(markdown(envelope ? envelope[3] : output))
    if (state.error) result.append(element("p", state.error, "error"))
    if (!output && !state.error)
      result.append(
        element(
          "p",
          snapshotStatus === "pending" || snapshotStatus === "running"
            ? labels.subagentAwaiting
            : labels.subagentUnavailable,
          "muted",
        ),
      )
    const feedback = element("p", "", "feedback")
    feedback.setAttribute("role", "status")
    body.append(result, details(labels.rawInputOutput, content), feedback)
    dialog.append(toolbar, body)
    trigger.addEventListener("click", () => {
      dialog.showModal()
      document.body.classList.add("modal-open")
    })
    dialog.addEventListener("close", () => {
      document.body.classList.remove("modal-open")
      trigger.focus({ preventScroll: true })
    })
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return
      const bounds = dialog.getBoundingClientRect()
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      )
        dialog.close()
    })
    box.append(trigger, dialog)
    return box
  }

  function skillView(state) {
    const name = typeof state.input?.name === "string" ? state.input.name : undefined
    const title = state.title || (name ? `Loaded skill: ${name}` : labels.skill)
    const box = element("section", undefined, "skill-card")
    box.setAttribute("aria-label", title)
    const heading = element("div", undefined, "skill-heading")
    heading.append(
      element("strong", labels.skill),
      element("span", labels[state.status] || state.status, `state ${state.status === "error" ? "error" : ""}`),
    )
    box.append(heading, element("strong", title, "skill-title"))
    if (state.error) box.append(element("p", state.error, "error"))
    return box
  }

  function partView(part, role, references, snapshot) {
    if (part.type === "text") {
      if (part.synthetic || part.ignored) return details(labels.details, element("pre", part.text))
      if (!part.text.trim()) return null
      return role === "user" ? element("div", part.text, "user-text") : markdown(part.text, references)
    }
    if (part.type === "reasoning") {
      const view = details(labels.reasoning, markdown(part.text))
      view.classList.add("reasoning-card")
      return view
    }
    if (part.type === "file") return attachment(part)
    if (part.type === "tool") {
      const state = part.state
      const content = element("div")
      content.append(element("h3", labels.input), element("pre", JSON.stringify(state.input, null, 2)))
      if (state.output !== undefined) content.append(element("h3", labels.output), element("pre", state.output))
      if (state.error) content.append(element("p", state.error, "error"))
      for (const file of state.attachments || []) content.append(attachment(file))
      if (snapshot) return questionView(snapshot, state, content)
      if (part.tool === "task") return subagentView(state, content)
      if (part.tool === "skill") return skillView(state)
      return details(state.title ? `${part.tool} · ${state.title}` : part.tool, content, state.status)
    }
    if (part.type === "step-start" || part.type === "step-finish") return null
    return details(labels.details, element("pre", JSON.stringify(part, null, 2)))
  }

  function messageView(role, created, identity) {
    const article = element("article", undefined, `message ${role === "user" ? "user" : "assistant"}`)
    const meta = element("div", undefined, "message-meta")
    meta.append(element("span", identity || (role === "user" ? labels.user : labels.assistant)))
    const time = date(created)
    if (time) meta.append(element("time", time))
    article.append(meta)
    const body = element("div", undefined, "message-body")
    article.append(body)
    return { article, body }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }))
    const link = element("a")
    link.href = url
    link.download = metadata.filename
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  async function render() {
    const header = element("header", undefined, "page-header")
    const top = element("div", undefined, "header-top")
    const button = element("button", labels.download, "download-button")
    button.type = "button"
    button.addEventListener("click", download)
    top.append(element("p", `${metadata.product} / ${labels.subtitle}`, "eyebrow"), button)
    header.append(top, element("h1", data.info.title || data.info.id))
    const times = element("div", undefined, "page-meta")
    const created = date(data.info.time?.created)
    if (created) times.append(element("span", `${labels.created} · ${created}`))
    times.append(element("span", `${labels.exported} · ${date(metadata.exportedAt)}`))
    header.append(times)
    const messages = element("section", undefined, "messages")
    messages.setAttribute("aria-label", labels.subtitle)
    root.replaceChildren(header, messages, status)
    if (!data.messages.length) messages.append(element("p", labels.empty, "empty"))
    // A provider continuation is another message, but belongs to the same reply.
    // Keep each reply's current segment and insertion point across batches.
    // A whole question card moves to the user side and closes the segment.
    const replies = new Map()
    for (let index = 0; index < data.messages.length; index += 40) {
      const batch = document.createDocumentFragment()
      for (let position = index; position < Math.min(index + 40, data.messages.length); position++) {
        const message = data.messages[position]
        const presentation = metadata.presentation[position]
        const parentID = message.info.role === "assistant" && message.info.parentID
        const reply = (parentID && replies.get(parentID)) || { view: undefined, tail: undefined, tools: undefined }
        if (parentID) replies.set(parentID, reply)
        let created = message.info.time?.created
        function append(content) {
          if (!reply.view) {
            reply.view = messageView(message.info.role, created)
            if (reply.tail) reply.tail.after(reply.view.article)
            else batch.append(reply.view.article)
            reply.tail = reply.view.article
          }
          reply.view.body.append(content)
        }
        function appendTool(content, state) {
          if (!reply.tools) {
            append(content)
            reply.tools = { first: content, group: undefined, states: [state] }
            return
          }
          if (!reply.tools.group) {
            const group = toolGroup([...reply.tools.states, state])
            reply.tools.first.replaceWith(group.box)
            group.body.append(reply.tools.first, content)
            reply.tools.group = group
            updateToolGroup(group)
            return
          }
          reply.tools.group.states.push(state)
          reply.tools.group.body.append(content)
          updateToolGroup(reply.tools.group)
        }
        for (const [partIndex, part] of message.parts.entries()) {
          const snapshot = questionSnapshot(part)
          const content = partView(part, message.info.role, presentation.references[partIndex], snapshot)
          const ordinaryTool =
            message.info.role === "assistant" &&
            part.type === "tool" &&
            part.tool !== "question" &&
            part.tool !== "task" &&
            part.tool !== "skill"
          if (ordinaryTool && content) {
            appendTool(content, part.state.status)
            continue
          }
          if (content) reply.tools = undefined
          if (snapshot && message.info.role === "assistant") {
            const answered = snapshot.some(({ answer }) => answer !== undefined)
            const response = messageView(
              "user",
              answered ? part.state.time?.end : part.state.time?.start,
              answered ? labels.user : labels.questions,
            )
            response.article.classList.add("question-message")
            response.body.append(content)
            if (reply.tail) reply.tail.after(response.article)
            if (!reply.tail) batch.append(response.article)
            reply.tail = response.article
            reply.view = undefined
            created = part.state.time?.end
            continue
          }
          if (content) append(content)
        }
        for (const annotation of presentation.annotations) {
          reply.tools = undefined
          const card = element("section", undefined, "annotation-card")
          card.id = annotation.id
          card.append(
            element("strong", labels.annotation.replace("{{index}}", annotation.index)),
            element("blockquote", annotation.context.selected),
            element("p", annotation.comment),
          )
          append(card)
        }
        if (message.info.error) {
          reply.tools = undefined
          append(element("p", message.info.error.data?.message || message.info.error.name, "error"))
        }
      }
      messages.append(batch)
      if (index + 40 < data.messages.length) await new Promise(requestAnimationFrame)
    }
  }

  render().catch(() => {
    const error = element("p", labels.failed, "error")
    error.setAttribute("role", "alert")
    root.append(error)
  })
}
