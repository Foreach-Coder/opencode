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

  function partView(part, role, references, snapshot) {
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
      if (snapshot) return questionView(snapshot, state, content)
      if (part.tool === "task") return subagentView(state, content)
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
        const reply = (parentID && replies.get(parentID)) || { view: undefined, tail: undefined }
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
        for (const [partIndex, part] of message.parts.entries()) {
          const snapshot = questionSnapshot(part)
          const content = partView(part, message.info.role, presentation.references[partIndex], snapshot)
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
          const card = element("section", undefined, "annotation-card")
          card.id = annotation.id
          card.append(
            element("strong", labels.annotation.replace("{{index}}", annotation.index)),
            element("blockquote", annotation.context.selected),
            element("p", annotation.comment),
          )
          append(card)
        }
        if (message.info.error)
          append(element("p", message.info.error.data?.message || message.info.error.name, "error"))
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
