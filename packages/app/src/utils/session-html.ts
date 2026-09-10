import type { SessionExportData } from "./session-export"
import { sessionExportFilename } from "./session-export"
import { sessionHtmlAnnotations } from "./session-html-annotations"

export type SessionHtmlAssets = { css: string; runtime: string; markdown: string }

export function createSessionHtml(
  data: SessionExportData,
  options: {
    assets: SessionHtmlAssets
    language: string
    labels: Record<string, string>
  },
) {
  const metadata = {
    formatVersion: 1,
    rendererVersion: 8,
    exportedAt: Date.now(),
    product: "CodeAgent",
    filename: sessionExportFilename(data.info),
    labels: options.labels,
    presentation: sessionHtmlAnnotations(data),
  }
  const runtime = `import { marked } from ${JSON.stringify(moduleUrl(options.assets.markdown))};\n${options.assets.runtime}\nrenderSessionExport(marked);`
  return `<!DOCTYPE html>
<html lang="${escapeHtml(options.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src data:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'">
<title>${escapeHtml(data.info.title || data.info.id)}</title>
<style>${options.assets.css}</style>
</head>
<body>
<main id="session-root"><p role="status">${escapeHtml(options.labels.loading)}</p></main>
<noscript>${escapeHtml(options.labels.javascript)}</noscript>
<script id="session-data" type="application/json">${embeddedJson(data)}</script>
<script id="export-metadata" type="application/json">${embeddedJson(metadata)}</script>
<script type="module" src="${escapeHtml(moduleUrl(runtime))}"></script>
</body>
</html>`
}

function embeddedJson(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function moduleUrl(source: string) {
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`
}
