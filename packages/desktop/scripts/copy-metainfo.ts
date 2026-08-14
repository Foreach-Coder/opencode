import path from "node:path"
import { resolveChannel } from "./utils"
import { resolveBrandDefinition, type BrandChannel, type ResolvedBrand } from "@opencode-ai/brand/config"

export async function generateMetainfo(
  channel: BrandChannel,
  resources = path.resolve("resources"),
  brand: ResolvedBrand,
) {
  const appId = escapeXml(brand.desktop[channel].appId)
  const productName = escapeXml(brand.desktop[channel].name)
  const desktopAppId = escapeXml(brand.desktopAppId)
  const brandName = escapeXml(brand.name)
  const summary = `Open source AI coding agent${channel !== "prod" ? ` (${channel})` : ""}`
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="${desktopAppId}">
    <name>${brandName}</name>
  </developer>

  <description>
    <p>
      ${brandName} is an open source agent that helps you write and run code with any AI model.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="vcs-browser">https://github.com/anomalyco/opencode</url>
</component>
`

  await Promise.all(
    Array.from(new Bun.Glob("*.metainfo.xml").scanSync({ cwd: resources, absolute: true })).map((file) =>
      Bun.file(file).delete(),
    ),
  )
  const target = path.join(resources, `${appId}.metainfo.xml`)
  await Bun.write(target, xml)
  return target
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;"
    if (character === "<") return "&lt;"
    if (character === ">") return "&gt;"
    if (character === '"') return "&quot;"
    return "&apos;"
  })
}

if (import.meta.main) {
  const arg = process.argv[2]
  const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()
  const target = await generateMetainfo(
    channel,
    path.resolve("resources"),
    resolveBrandDefinition(process.env.PRODUCT_BRAND_JSON),
  )
  console.log(`Generated metainfo for ${channel} at ${path.relative(process.cwd(), target)}`)
}
