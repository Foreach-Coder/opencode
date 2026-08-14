import { defineConfig, PluginOption } from "vite"
import { solidStart } from "@solidjs/start/config"
import { nitro } from "nitro/vite"
import tailwindcss from "@tailwindcss/vite"
import { resolveBrandDefinition } from "@opencode-ai/brand/config"
import { productIdentityPlugin } from "../app/product-identity-plugin"

const productBrand = resolveBrandDefinition(process.env.PRODUCT_BRAND_JSON)
const productVisualSource = process.env.PRODUCT_VISUAL_JSON
if (!productVisualSource) throw new Error("PRODUCT_VISUAL_JSON is required")

const nitroConfig: any = (() => {
  const target = process.env.OPENCODE_DEPLOYMENT_TARGET
  if (target === "cloudflare") {
    return {
      compatibilityDate: "2024-09-19",
      preset: "cloudflare-module",
      cloudflare: {
        nodeCompat: true,
      },
    }
  }
  return {}
})()

export default defineConfig({
  define: {
    PRODUCT_BRAND_JSON: JSON.stringify(JSON.stringify(productBrand)),
    PRODUCT_VISUAL_JSON: JSON.stringify(productVisualSource),
  },
  plugins: [
    productIdentityPlugin(productBrand.name),
    tailwindcss(),
    solidStart() as PluginOption,
    nitro({
      ...nitroConfig,
      baseURL: process.env.OPENCODE_BASE_URL,
    }),
  ],
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3002,
  },
  worker: {
    format: "es",
  },
})
