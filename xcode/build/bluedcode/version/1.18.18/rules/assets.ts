import type { TransformRule } from "../../../common/transform/types"

const html = "packages/desktop/src/renderer/index.html"

export const assetRules: readonly TransformRule[] = [
  {
    id: "renderer-favicon-png",
    file: html,
    kind: "exact-text",
    selector: "document",
    from: 'href="./favicon-96x96-v3.png"',
    to: 'href="./favicon.png"',
    expected: 1,
    classification: "product",
    reason: "使用隔离 stage 中派生的 BluedCode PNG favicon",
  },
  {
    id: "renderer-favicon-svg",
    file: html,
    kind: "exact-text",
    selector: "document",
    from: 'href="./favicon-v3.svg"',
    to: 'href="./favicon.svg"',
    expected: 1,
    classification: "product",
    reason: "使用隔离 stage 中派生的 BluedCode SVG favicon",
  },
  {
    id: "renderer-favicon-ico",
    file: html,
    kind: "exact-text",
    selector: "document",
    from: 'href="./favicon-v3.ico"',
    to: 'href="./favicon.ico"',
    expected: 1,
    classification: "product",
    reason: "使用隔离 stage 中派生的 BluedCode ICO favicon",
  },
  {
    id: "renderer-apple-touch-icon",
    file: html,
    kind: "exact-text",
    selector: "document",
    from: 'href="./apple-touch-icon-v3.png"',
    to: 'href="./favicon.png"',
    expected: 1,
    classification: "product",
    reason: "不把上游 Apple 图标带入 Windows Desktop 资源图",
  },
]

export const desktopAssetPolicy = {
  include: ["app-icon.svg", "app-icon.png", "wordmark.svg"],
  renderer: ["favicon.svg", "favicon.png", "favicon.ico"],
  exclude: ["tui.json"],
} as const
