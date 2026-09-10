import type { useLanguage } from "../context/language"
import { downloadSessionBlob, type SessionExportData } from "./session-export"
import { createSessionHtml } from "./session-html"
import { sessionHtmlLabels } from "./session-html-labels"
import markdown from "marked?raw"
import runtime from "./session-html/runtime.js?raw"
import css from "./session-html/style.css?raw"

export function downloadSessionHtml(
  filename: string,
  data: SessionExportData,
  language: ReturnType<typeof useLanguage>,
) {
  const html = createSessionHtml(data, {
    assets: { markdown, runtime, css },
    labels: sessionHtmlLabels(language.t),
    language: language.intl(),
  })
  downloadSessionBlob(filename, new Blob([html], { type: "text/html;charset=utf-8" }))
}
