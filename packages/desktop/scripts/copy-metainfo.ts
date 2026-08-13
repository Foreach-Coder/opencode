import { resolveChannel } from "./utils"
import { Brand } from "@opencode-ai/brand"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const appId = Brand.desktop[channel].appId
const productName = Brand.desktop[channel].name
const summary = `Open source AI coding agent${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="${Brand.desktopAppId}">
    <name>${Brand.name}</name>
  </developer>

  <description>
    <p>
      ${Brand.name} is an open source agent that helps you write and run code with any AI model.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="vcs-browser">https://github.com/anomalyco/opencode</url>
</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
