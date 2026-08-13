import type { WslDistroProbe, WslOpencodeCheck, WslServerItem } from "../../preload/types"
import { Brand } from "@opencode-ai/brand"

export const WSL_EXECUTABLE_PROBE = `if [ -x "$HOME/.${Brand.directory}/bin/${Brand.cli}" ]; then printf "%s\\n" "$HOME/.${Brand.directory}/bin/${Brand.cli}"; fi`

export function wslInstallUnavailable() {
  return {
    code: 1,
    signal: null,
    stdout: "",
    stderr: `${Brand.name} internal installer is not configured`,
  }
}

export function wslServerIdToRestart(servers: WslServerItem[], distro: string) {
  return servers.find((item) => item.config.distro === distro)?.config.id
}

export function clearWslDistroState(
  distroProbes: Record<string, WslDistroProbe>,
  opencodeChecks: Record<string, WslOpencodeCheck>,
  distro: string,
) {
  const nextDistroProbes = { ...distroProbes }
  const nextOpencodeChecks = { ...opencodeChecks }
  delete nextDistroProbes[distro]
  delete nextOpencodeChecks[distro]
  return { distroProbes: nextDistroProbes, opencodeChecks: nextOpencodeChecks }
}

export function wslTerminalArgs(distro?: string | null) {
  return ["/c", "start", "", "wsl", ...(distro ? ["-d", distro] : [])]
}

export function requireWslIpcString(name: string, value: unknown) {
  if (typeof value === "string" && value.length > 0) return value
  throw new Error(`Invalid ${name}`)
}
