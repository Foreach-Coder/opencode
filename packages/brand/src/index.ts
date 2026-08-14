export {
  parseBrandDefinition,
  resolveBrandDefinition,
  resolveBrand,
  type BrandChannel,
  type BrandInput,
  type ResolveBrandInput,
  type ResolvedBrand,
} from "@opencode-ai/brand/config"
import { resolveBrandDefinition } from "@opencode-ai/brand/config"

declare const PRODUCT_BRAND_JSON: string

export const Brand = resolveBrandDefinition(PRODUCT_BRAND_JSON)
export { PixelFont, layoutPixelText, pixelAccentIndex, renderTerminalPixelText, type PixelCell } from "./pixel"
