import { defineConfig } from "vite"
import desktopPlugin from "./vite"
import { resolveBrandDefinition } from "@opencode-ai/brand/config"
import { resolveVisualAssets } from "@opencode-ai/brand/assets-config"
import { productIdentityPlugin } from "./product-identity-plugin"

const productBrand = resolveBrandDefinition(process.env.PRODUCT_BRAND_JSON)
const productBrandDefine = JSON.stringify(JSON.stringify(productBrand))
const productVisualSource = process.env.PRODUCT_VISUAL_JSON
const productVisual = resolveVisualAssets(productVisualSource)
const productVisualDefine = JSON.stringify(productVisualSource)

export default defineConfig({
  define: {
    PRODUCT_BRAND_JSON: productBrandDefine,
    PRODUCT_VISUAL_JSON: productVisualDefine,
  },
  plugins: [
    desktopPlugin,
    productIdentityPlugin(productBrand.name),
    {
      name: "opencode:product-identity",
      transformIndexHtml(html) {
        const title = productBrand.name.replace(
          /[&<>"]/g,
          (value) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[value]!,
        )
        const branded = html.replace(/<title>.*?<\/title>/s, `<title>${title}</title>`)
        return branded
          .replace(/\s*<link rel="(?:icon|shortcut icon|apple-touch-icon|manifest)"[^>]*>/g, "")
          .replace(
            "</title>",
            `</title>\n    <link rel="icon" type="image/svg+xml" href="${productVisual.appIcon.dataUri}" />`,
          )
      },
    },
  ] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
})
