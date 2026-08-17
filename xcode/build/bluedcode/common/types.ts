export type BuildRequest = {
  channel: "dev" | "prod"
  release?: string
  auditOnly?: true
}

export type BuildIdentity = {
  channel: "dev" | "prod"
  name: "BluedCode" | "BluedCode Dev"
  appId: "ai.bluedcode.desktop" | "ai.bluedcode.desktop.dev"
  protocol: "bluedcode" | "bluedcode-dev"
  version: string
  commit: string
  shortCommit: string
  artifactName: string
  tag?: string
}

export type BuildBaseline = {
  desktopVersion: string
}

export type SnapshotManifest = {
  frameworkVersion: 1
  files: Record<string, string>
}
