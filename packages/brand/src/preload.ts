const brand = process.env.PRODUCT_BRAND_JSON
const visuals = process.env.PRODUCT_VISUAL_JSON
if (!brand) throw new Error("PRODUCT_BRAND_JSON is required")
if (!visuals) throw new Error("PRODUCT_VISUAL_JSON is required")

Reflect.set(globalThis, "PRODUCT_BRAND_JSON", brand)
Reflect.set(globalThis, "PRODUCT_VISUAL_JSON", visuals)
