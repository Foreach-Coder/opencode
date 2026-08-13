import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"
import { Brand } from "@opencode-ai/brand"

const channels = [
  {
    channel: "dev",
    appId: Brand.desktop.dev.appId,
    productName: Brand.desktop.dev.name,
    packageName: `${Brand.slug}-dev`,
  },
  {
    channel: "beta",
    appId: Brand.desktop.beta.appId,
    productName: Brand.desktop.beta.name,
    packageName: `${Brand.slug}-beta`,
  },
  {
    channel: "prod",
    appId: Brand.desktop.prod.appId,
    productName: Brand.desktop.prod.name,
    packageName: Brand.slug,
  },
] as const

for (const channel of channels) {
  test(`uses one Linux desktop identity for ${channel.channel}`, async () => {
    const previous = process.env.OPENCODE_CHANNEL
    process.env.OPENCODE_CHANNEL = channel.channel

    const module = await import(`./electron-builder.config.ts?channel=${channel.channel}`)
    const config = module.default as Configuration

    if (previous === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = previous

    expect(config.appId).toBe(channel.appId)
    expect(config.productName).toBe(channel.productName)
    expect(config.extraMetadata?.desktopName).toBe(`${channel.appId}.desktop`)
    expect(config.artifactName).toBe(`${Brand.slug}-desktop-\${os}-\${arch}.\${ext}`)
    expect(config.protocols).toEqual({ name: channel.productName, schemes: [Brand.protocol] })
    expect(config.linux?.executableName).toBe(channel.appId)
    expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(channel.appId)
    expect(config.deb?.packageName).toBe(channel.packageName)
    expect(config.rpm?.packageName).toBe(channel.packageName)
    expect(config.publish).toBeUndefined()
    expect(config.deb?.fpm).toBeUndefined()
    expect(config.rpm?.fpm).toBeUndefined()
  })
}
