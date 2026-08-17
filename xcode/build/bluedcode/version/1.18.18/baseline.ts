import type { BuildBaseline } from "../../common/types"
import baselineData from "./baseline.json"

export const baseline = {
  tag: baselineData.tag,
  commit: baselineData.commit,
  desktopVersion: "1.18.18",
} satisfies BuildBaseline & { tag: string; commit: string }
