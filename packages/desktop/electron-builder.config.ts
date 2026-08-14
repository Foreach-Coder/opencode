import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"
import { resolveBrandDefinition } from "@opencode-ai/brand/config"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const productBrand = resolveBrandDefinition(process.env.PRODUCT_BRAND_JSON)
const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return productBrand.channel
})()

const APP_IDS = {
  dev: productBrand.desktop.dev.appId,
  beta: productBrand.desktop.beta.appId,
  prod: productBrand.desktop.prod.appId,
} as const
const buildResources = process.env.PRODUCT_BUILD_STAGE ? `${process.env.PRODUCT_BUILD_STAGE}/resources` : "resources"
const productIcon = process.env.PRODUCT_BUILD_STAGE ? `${buildResources}/icons/app-icon.svg` : undefined

const getBase = (appId: string): Configuration => ({
  artifactName: `${productBrand.slug}-desktop-\${os}-\${arch}.\${ext}`,
  directories: {
    output: process.env.PRODUCT_BUILD_STAGE ? `${process.env.PRODUCT_BUILD_STAGE}/artifacts` : "dist",
    buildResources,
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. Otherwise Electron appends another desktop suffix.
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    author: { name: productBrand.name },
    desktopName: `${appId}.desktop`,
  },
  files: process.env.PRODUCT_BUILD_STAGE
    ? [
        "package.json",
        "node_modules/**/*",
        { from: `${process.env.PRODUCT_BUILD_STAGE}/out`, to: "out", filter: ["**/*"] },
        { from: `${process.env.PRODUCT_BUILD_STAGE}/resources`, to: "resources", filter: ["**/*"] },
      ]
    : ["out/**/*", "resources/**/*"],
  extraResources: [
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: productIcon ?? `${buildResources}/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: true,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: productBrand.name,
    schemes: [productBrand.protocol],
  },
  win: {
    icon: productIcon ?? `${buildResources}/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: productIcon ? undefined : `${buildResources}/icons/icon.ico`,
    installerHeaderIcon: productIcon ? undefined : `${buildResources}/icons/icon.ico`,
  },
  linux: {
    icon: productIcon ?? `${buildResources}/icons`,
    category: "Development",
    executableName: appId,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: productBrand.desktop.dev.name,
        protocols: { name: productBrand.desktop.dev.name, schemes: [productBrand.protocol] },
        deb: { packageName: `${productBrand.slug}-dev` },
        rpm: { packageName: `${productBrand.slug}-dev` },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: productBrand.desktop.beta.name,
        protocols: { name: productBrand.desktop.beta.name, schemes: [productBrand.protocol] },
        deb: { packageName: `${productBrand.slug}-beta` },
        rpm: { packageName: `${productBrand.slug}-beta` },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: productBrand.name,
        protocols: { name: productBrand.name, schemes: [productBrand.protocol] },
        deb: { packageName: productBrand.slug },
        rpm: { packageName: productBrand.slug },
      }
    }
  }
}

export default getConfig()
