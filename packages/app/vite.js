import { readFileSync } from "node:fs"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"

const theme = fileURLToPath(new URL("./public/oc-theme-preload.js", import.meta.url))
const productBrandSource = process.env.PRODUCT_BRAND_JSON
if (!productBrandSource) throw new Error("PRODUCT_BRAND_JSON is required")
const productBrand = JSON.parse(productBrandSource)
const productSlug = productBrand.slug
const productChannel = productBrand.channel
if (typeof productSlug !== "string" || !productSlug) throw new Error("PRODUCT_BRAND_JSON slug is required")
if (productChannel !== "dev" && productChannel !== "beta" && productChannel !== "prod")
  throw new Error("PRODUCT_BRAND_JSON channel is required")
const themeSource = readFileSync(theme, "utf8").replace(
  /\/\/ brand:start[\s\S]*?\/\/ brand:end/,
  `// brand:start\n  var productSlug = ${JSON.stringify(productSlug)}\n  // brand:end`,
)

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (process.env.OPENCODE_CHANNEL === "latest") return "prod"
  return productChannel
})()

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "opencode-desktop:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
        define: {
          "import.meta.env.VITE_OPENCODE_CHANNEL": JSON.stringify(channel),
        },
        worker: {
          format: "es",
        },
      }
    },
  },
  {
    name: "opencode-desktop:theme-preload",
    transformIndexHtml(html) {
      return html.replace(
        '<script id="oc-theme-preload-script" src="/oc-theme-preload.js"></script>',
        `<script id="oc-theme-preload-script">${themeSource}</script>`,
      )
    },
  },
  tailwindcss(),
  solidPlugin(),
]
