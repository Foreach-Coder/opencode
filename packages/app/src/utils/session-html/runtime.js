// This standalone source is embedded verbatim, with Marked supplied by the HTML shell.
// Keep it independent of the app, browser storage and remote resources.
function renderSessionExport(marked) {
  const root = document.getElementById("session-root")
  const data = JSON.parse(document.getElementById("session-data").textContent)
  const metadata = JSON.parse(document.getElementById("export-metadata").textContent)
  const labels = metadata.labels
  const status = element("p", "", "feedback")
  status.setAttribute("role", "status")

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
    const template = document.createElement("template")
    template.innerHTML = marked.parse(chars.join(""), { async: false, gfm: true })
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
      const block = element("div", undefined, "code-block")
      const toolbar = element("div", undefined, "code-toolbar")
      const button = element("button", labels.copy)
      button.type = "button"
      button.addEventListener("click", () => copy(text))
      toolbar.append(button)
      pre.replaceWith(block)
      block.append(toolbar, pre)
    })
    return body
  }

  async function copy(text) {
    const copied = navigator.clipboard
      ? await navigator.clipboard.writeText(text).then(
          () => true,
          () => false,
        )
      : false
    if (copied) {
      status.textContent = labels.copied
      return
    }
    const focused = document.activeElement
    const field = element("textarea", text, "clipboard-field")
    document.body.append(field)
    field.select()
    try {
      status.textContent = document.execCommand("copy") ? labels.copied : labels.copyFailed
    } catch {
      status.textContent = labels.copyFailed
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

  function partView(part, role, references) {
    if (part.type === "text") {
      if (part.synthetic || part.ignored) return details(labels.details, element("pre", part.text))
      if (!part.text.trim()) return null
      return role === "user" ? element("div", part.text, "user-text") : markdown(part.text, references)
    }
    if (part.type === "reasoning") return details(labels.reasoning, markdown(part.text))
    if (part.type === "file") return attachment(part)
    if (part.type === "tool") {
      const state = part.state
      const content = element("div")
      content.append(element("h3", labels.input), element("pre", JSON.stringify(state.input, null, 2)))
      if (state.output !== undefined) content.append(element("h3", labels.output), element("pre", state.output))
      if (state.error) content.append(element("p", state.error, "error"))
      for (const file of state.attachments || []) content.append(attachment(file))
      return details(state.title ? `${part.tool} · ${state.title}` : part.tool, content, state.status)
    }
    if (part.type === "step-start" || part.type === "step-finish") return null
    return details(labels.details, element("pre", JSON.stringify(part, null, 2)))
  }

  function messageView(message) {
    const role = message.info.role
    const article = element("article", undefined, `message ${role === "user" ? "user" : "assistant"}`)
    const meta = element("div", undefined, "message-meta")
    meta.append(element("span", role === "user" ? labels.user : labels.assistant))
    const time = date(message.info.time?.created)
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
    // Keep this map across batches; missing parent IDs must not merge unrelated records.
    const replies = new Map()
    for (let index = 0; index < data.messages.length; index += 40) {
      const batch = document.createDocumentFragment()
      for (let position = index; position < Math.min(index + 40, data.messages.length); position++) {
        const message = data.messages[position]
        const presentation = metadata.presentation[position]
        const parentID = message.info.role === "assistant" && message.info.parentID
        const existing = parentID && replies.get(parentID)
        const view = existing || messageView(message)
        if (!existing) {
          batch.append(view.article)
          if (parentID) replies.set(parentID, view)
        }
        for (const [partIndex, part] of message.parts.entries()) {
          const content = partView(part, message.info.role, presentation.references[partIndex])
          if (content) view.body.append(content)
        }
        for (const annotation of presentation.annotations) {
          const card = element("section", undefined, "annotation-card")
          card.id = annotation.id
          card.append(
            element("strong", labels.annotation.replace("{{index}}", annotation.index)),
            element("blockquote", annotation.context.selected),
            element("p", annotation.comment),
          )
          view.body.append(card)
        }
        if (message.info.error)
          view.body.append(element("p", message.info.error.data?.message || message.info.error.name, "error"))
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
