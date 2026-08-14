const brand = process.env.PRODUCT_BRAND_JSON
  ? JSON.parse(process.env.PRODUCT_BRAND_JSON)
  : {
      name: "Acme Test Code",
      slug: "acme-test-code",
      channel: "dev",
      desktopAppId: "com.acme.test-code",
      disableProviderConnections: false,
    }
const wordmarkSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 5"><path fill="currentColor" d="M0 0h20v5H0z"/></svg>'
const appIconSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>'
const tuiWordmarkGrid = {
  width: 2,
  height: 2,
  cells: [
    [1, 0],
    [0, 1],
  ],
}

Reflect.set(globalThis, "PRODUCT_BRAND_JSON", JSON.stringify(brand))
Reflect.set(globalThis, "PRODUCT_VISUAL_JSON", JSON.stringify({ wordmarkSvg, appIconSvg, tuiWordmarkGrid }))
process.env.PRODUCT_BRAND_JSON = JSON.stringify(brand)
process.env.PRODUCT_VISUAL_JSON = JSON.stringify({ wordmarkSvg, appIconSvg, tuiWordmarkGrid })
