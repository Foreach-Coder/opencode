import { defineConfig } from "electron-vite"
import appPlugin from "@opencode-ai/app/vite"
import { productIdentityPlugin } from "../app/product-identity-plugin"
import { resolveBrandDefinition } from "@opencode-ai/brand/config"
import { readFile, readdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import pkg from "./package.json"
import { requireProductVersion } from "./product-version"

const OPENCODE_SERVER_DIST = process.env.PRODUCT_BUILD_STAGE
  ? `${process.env.PRODUCT_BUILD_STAGE}/server`
  : "../opencode/dist/node"

const nodePtyPkg = `@lydell/node-pty-${process.platform}-${process.arch}`
const productBrandSource = process.env.PRODUCT_BRAND_JSON
const productBrand = resolveBrandDefinition(productBrandSource)
const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (raw === "latest") return "prod"
  return productBrand.channel
})()
const productBrandDefine = JSON.stringify(JSON.stringify(productBrand))
if (!process.env.PRODUCT_VISUAL_JSON) throw new Error("PRODUCT_VISUAL_JSON is required")
const productVisualDefine = JSON.stringify(process.env.PRODUCT_VISUAL_JSON)
const productBuildStage = process.env.PRODUCT_BUILD_STAGE
const productVersion = productBuildStage
  ? requireProductVersion(process.env.OPENCODE_VERSION)
  : process.env.OPENCODE_VERSION || pkg.version
const jsoncParserEsm = createRequire(new URL("../opencode/package.json", import.meta.url)).resolve(
  "jsonc-parser/lib/esm/main.js",
)

export default defineConfig({
  main: {
    define: {
      "import.meta.env.OPENCODE_CHANNEL": JSON.stringify(channel),
      PRODUCT_BRAND_JSON: productBrandDefine,
      PRODUCT_VISUAL_JSON: productVisualDefine,
    },
    build: {
      outDir: productBuildStage ? `${productBuildStage}/out/main` : undefined,
      rollupOptions: {
        input: { index: "src/main/index.ts", sidecar: "src/main/sidecar.ts" },
      },
      externalizeDeps: {
        include: [nodePtyPkg],
        exclude: ["@opencode-ai/brand"],
      },
    },
    plugins: [
      {
        name: "opencode:jsonc-parser-esm",
        enforce: "pre",
        resolveId(id) {
          if (id === "jsonc-parser") return jsoncParserEsm
        },
      },
      {
        name: "opencode:node-pty-narrower",
        enforce: "pre",
        resolveId(s) {
          if (s === "@lydell/node-pty") return nodePtyPkg
        },
      },
      {
        name: "opencode:virtual-server-module",
        enforce: "pre",
        resolveId(id) {
          if (id === "virtual:opencode-server") return this.resolve(`${OPENCODE_SERVER_DIST}/node.js`)
        },
      },
      {
        name: "opencode:copy-server-assets",
        async writeBundle() {
          for (const file of await readdir(OPENCODE_SERVER_DIST)) {
            if (!file.endsWith(".wasm")) continue
            await writeFile(
              path.join(productBuildStage ?? ".", "out", "main", "chunks", file),
              await readFile(path.join(OPENCODE_SERVER_DIST, file)),
            )
          }
        },
      },
    ],
  },
  preload: {
    define: {
      PRODUCT_BRAND_JSON: productBrandDefine,
      PRODUCT_VISUAL_JSON: productVisualDefine,
    },
    build: {
      outDir: productBuildStage ? `${productBuildStage}/out/preload` : undefined,
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    define: {
      "import.meta.env.VITE_OPENCODE_CHANNEL": JSON.stringify(channel),
      "import.meta.env.VITE_PRODUCT_VERSION": JSON.stringify(productVersion),
      PRODUCT_BRAND_JSON: productBrandDefine,
      PRODUCT_VISUAL_JSON: productVisualDefine,
    },
    plugins: [
      appPlugin,
      productIdentityPlugin(productBrand.name),
      {
        name: "opencode:product-title",
        transformIndexHtml(html) {
          const title = productBrand.name.replace(
            /[&<>"]/g,
            (value) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[value]!,
          )
          const branded = html.replace(/<title>.*?<\/title>/s, `<title>${title}</title>`)
          if (!productBuildStage) return branded
          return branded
            .replace(/\s*<link rel="(?:icon|shortcut icon|apple-touch-icon)"[^>]*>/g, "")
            .replace(/\s*<meta property="(?:og:image|twitter:image)"[^>]*>/g, "")
            .replace("</title>", '</title>\n    <link rel="icon" type="image/svg+xml" href="./app-icon.svg" />')
        },
      },
    ],
    publicDir: productBuildStage ? `${productBuildStage}/public` : "../../../app/public",
    root: "src/renderer",
    build: {
      outDir: productBuildStage ? `${productBuildStage}/out/renderer` : undefined,
      sourcemap: productBuildStage ? false : true,
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
        },
      },
    },
  },
})
