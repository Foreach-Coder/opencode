import type { Plugin } from "vite"

export function productIdentityPlugin(productName: string): Plugin {
  return {
    name: "opencode:product-static-identity",
    enforce: "pre",
    transform(code, id) {
      const source = id.replaceAll("\\", "/").split("?", 1)[0]
      if (source.endsWith("/packages/ui/src/theme/themes/opencode.json")) {
        return code.replace(/("name"\s*:\s*)"[^"]*"/, (_, prefix: string) => prefix + JSON.stringify(productName))
      }
      if (!source.includes("/packages/sdk/js/src/") || !source.endsWith(".gen.ts")) return
      return code
    },
  }
}
