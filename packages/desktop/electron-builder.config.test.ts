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

test("uses the injected product brand and isolated output paths", async () => {
  const previousBrand = process.env.PRODUCT_BRAND_JSON
  const previousStage = process.env.PRODUCT_BUILD_STAGE
  const previousVersion = process.env.OPENCODE_VERSION
  const brand = {
    ...Brand,
    name: "FKGCODE",
    slug: "fkgcode",
    cli: "fkgcode",
    protocol: "fkgcode",
    directory: "fkgcode",
    database: "fkgcode.db",
    log: "fkgcode.log",
    desktopAppId: "ai.fkgcode.desktop",
    channel: "prod",
    desktop: {
      dev: { name: "FKGCODE Dev", appId: "ai.fkgcode.desktop.dev" },
      beta: { name: "FKGCODE Beta", appId: "ai.fkgcode.desktop.beta" },
      prod: { name: "FKGCODE", appId: "ai.fkgcode.desktop" },
    },
  }
  process.env.PRODUCT_BRAND_JSON = JSON.stringify(brand)
  process.env.PRODUCT_BUILD_STAGE = "D:/product-build/fkgcode/prod"
  process.env.OPENCODE_CHANNEL = "prod"
  process.env.OPENCODE_VERSION = "1.17.9-260814-01"
  const module = await import(`./electron-builder.config.ts?brand=${Date.now()}`)
  if (previousBrand === undefined) delete process.env.PRODUCT_BRAND_JSON
  else process.env.PRODUCT_BRAND_JSON = previousBrand
  if (previousStage === undefined) delete process.env.PRODUCT_BUILD_STAGE
  else process.env.PRODUCT_BUILD_STAGE = previousStage
  if (previousVersion === undefined) delete process.env.OPENCODE_VERSION
  else process.env.OPENCODE_VERSION = previousVersion
  const config = module.default as Configuration

  expect(config.productName).toBe("FKGCODE")
  expect(config.extraMetadata?.author).toEqual({ name: "FKGCODE" })
  expect(config.extraMetadata?.version).toBe("1.17.9-260814-01")
  expect(config.appId).toBe("ai.fkgcode.desktop")
  expect(config.artifactName).toBe("fkgcode-desktop-${os}-${arch}.${ext}")
  expect(config.directories?.output).toBe("D:/product-build/fkgcode/prod/artifacts")
  expect(config.directories?.buildResources).toBe("D:/product-build/fkgcode/prod/resources")
  expect(config.win?.icon).toBe("D:/product-build/fkgcode/prod/resources/icons/app-icon.svg")
  expect(config.mac?.icon).toBe("D:/product-build/fkgcode/prod/resources/icons/app-icon.svg")
  expect(config.linux?.icon).toBe("D:/product-build/fkgcode/prod/resources/icons/app-icon.svg")
})

test("rejects a staged product build without an explicit combined version", async () => {
  const previousBrand = process.env.PRODUCT_BRAND_JSON
  const previousStage = process.env.PRODUCT_BUILD_STAGE
  const previousVersion = process.env.OPENCODE_VERSION
  process.env.PRODUCT_BRAND_JSON = JSON.stringify(Brand)
  process.env.PRODUCT_BUILD_STAGE = "D:/product-build/strict-version/prod"
  delete process.env.OPENCODE_VERSION

  await expect(import(`./electron-builder.config.ts?missing-version=${Date.now()}`)).rejects.toThrow("OPENCODE_VERSION")

  if (previousBrand === undefined) delete process.env.PRODUCT_BRAND_JSON
  else process.env.PRODUCT_BRAND_JSON = previousBrand
  if (previousStage === undefined) delete process.env.PRODUCT_BUILD_STAGE
  else process.env.PRODUCT_BUILD_STAGE = previousStage
  if (previousVersion === undefined) delete process.env.OPENCODE_VERSION
  else process.env.OPENCODE_VERSION = previousVersion
})
