export * as ConfigManaged from "./managed"

import { existsSync } from "fs"
import os from "os"
import path from "path"
import { Process } from "@/util/process"
import { Brand } from "@opencode-ai/brand"

export const MANAGED_PLIST_DOMAIN = `ai.${Brand.slug}.managed`

// Keys injected by macOS/MDM into the managed plist that are not product config
const PLIST_META = new Set([
  "PayloadDisplayName",
  "PayloadIdentifier",
  "PayloadType",
  "PayloadUUID",
  "PayloadVersion",
  "_manualProfile",
])

export function systemManagedConfigDir(platform = process.platform, programData = process.env.ProgramData) {
  switch (platform) {
    case "darwin":
      return `/Library/Application Support/${Brand.directory}`
    case "win32":
      return path.win32.join(programData || "C:\\ProgramData", Brand.directory)
    default:
      return `/etc/${Brand.directory}`
  }
}

export function managedConfigDir() {
  return process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR || systemManagedConfigDir()
}

export function parseManagedPlist(json: string): string {
  const raw = JSON.parse(json)
  for (const key of Object.keys(raw)) {
    if (PLIST_META.has(key)) delete raw[key]
  }
  return JSON.stringify(raw)
}

export async function readManagedPreferences() {
  if (process.platform !== "darwin") return

  const user = (() => {
    try {
      return os.userInfo().username || "user"
    } catch {
      return "user"
    }
  })()
  const paths = [
    path.join("/Library/Managed Preferences", user, `${MANAGED_PLIST_DOMAIN}.plist`),
    path.join("/Library/Managed Preferences", `${MANAGED_PLIST_DOMAIN}.plist`),
  ]

  for (const plist of paths) {
    if (!existsSync(plist)) continue
    const result = await Process.run(["plutil", "-convert", "json", "-o", "-", plist], { nothrow: true })
    if (result.code !== 0) continue
    return {
      source: `mobileconfig:${plist}`,
      text: parseManagedPlist(result.stdout.toString()),
    }
  }

  return
}
