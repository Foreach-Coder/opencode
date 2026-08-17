import { createHash } from "node:crypto"
import path from "node:path"
import type { BuildIdentity } from "./types"

export type BuildPaths = {
  repositoryRoot: string
  frameworkRoot: string
  versionRoot: string
  outputRoot: string
  cacheRoot: string
  workspaceRoot: string
  serverDir: string
  stageDir: string
  outDir: string
  artifactsDir: string
  serverEntry: string
  bunLockFile: string
  opencodePackageFile: string
  desktopPackageFile: string
  snapshotManifestFile: string
}

export function createBuildPaths(
  identity: BuildIdentity,
  repositoryRoot = path.resolve(import.meta.dir, "../../../.."),
): BuildPaths {
  const root = path.resolve(repositoryRoot)
  const outputRoot = path.join(root, ".xcode", "bluedcode")
  const version = requireUpstreamVersion(identity.version)
  const identityDigest = createHash("sha256")
    .update(
      JSON.stringify({
        channel: identity.channel,
        name: identity.name,
        appId: identity.appId,
        protocol: identity.protocol,
        version: identity.version,
        commit: identity.commit,
        shortCommit: identity.shortCommit,
        artifactName: identity.artifactName,
        tag: identity.tag,
      }),
    )
    .digest("hex")
    .slice(0, 16)
  const workspaceRoot = path.join(outputRoot, "workspaces", `${identity.channel}-${identityDigest}`)
  const frameworkRoot = path.join(root, "xcode", "build", "bluedcode")
  return {
    repositoryRoot: root,
    frameworkRoot,
    versionRoot: path.join(frameworkRoot, "version", version),
    outputRoot,
    cacheRoot: path.join(outputRoot, "cache"),
    workspaceRoot,
    serverDir: path.join(workspaceRoot, "server"),
    stageDir: path.join(workspaceRoot, "stage"),
    outDir: path.join(workspaceRoot, "out"),
    artifactsDir: path.join(workspaceRoot, "artifacts"),
    serverEntry: path.join(root, "packages", "opencode", "src", "node.ts"),
    bunLockFile: path.join(root, "bun.lock"),
    opencodePackageFile: path.join(root, "packages", "opencode", "package.json"),
    desktopPackageFile: path.join(root, "packages", "desktop", "package.json"),
    snapshotManifestFile: path.join(frameworkRoot, "snapshot-manifest.json"),
  }
}

function requireUpstreamVersion(version: string) {
  const match = /^\d+\.\d+\.\d+/.exec(version)
  if (!match) throw new Error("构建身份版本缺少上游语义版本")
  return match[0]
}
