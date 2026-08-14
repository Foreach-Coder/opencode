export {
  resolveVisualAssets,
  type ProductVisualAssets,
  type ProductVisualDefinition,
  type TuiWordmarkGrid,
  type WordmarkAsset,
} from "./assets-config"
import { resolveVisualAssets } from "./assets-config"

declare const PRODUCT_VISUAL_JSON: string

export const VisualAssets = resolveVisualAssets(PRODUCT_VISUAL_JSON)
