import { Link, Meta } from "@solidjs/meta"
import { Brand } from "@opencode-ai/brand"
import { VisualAssets } from "@opencode-ai/brand/assets"

export const Favicon = () => {
  return (
    <>
      <Link rel="icon" type="image/svg+xml" href={VisualAssets.appIcon.dataUri} />
      <Meta name="apple-mobile-web-app-title" content={Brand.name} />
    </>
  )
}
