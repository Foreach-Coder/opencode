import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Schema, Context } from "effect"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import path from "path"
import { EventV2 } from "@opencode-ai/core/event"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import semver from "semver"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import { Brand } from "@opencode-ai/brand"

export type Method = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown"

export type ReleaseType = "patch" | "minor" | "major"

export const Event = {
  Updated: EventV2.define({
    type: "installation.updated",
    schema: {
      version: Schema.String,
    },
  }),
  UpdateAvailable: EventV2.define({
    type: "installation.update-available",
    schema: {
      version: Schema.String,
    },
  }),
}

export function getReleaseType(current: string, latest: string): ReleaseType {
  const currMajor = semver.major(current)
  const currMinor = semver.minor(current)
  const newMajor = semver.major(latest)
  const newMinor = semver.minor(latest)

  if (newMajor > currMajor) return "major"
  if (newMinor > currMinor) return "minor"
  return "patch"
}

export const Info = Schema.Struct({
  version: Schema.String,
  latest: Schema.String,
}).annotate({ identifier: "InstallationInfo" })
export type Info = Schema.Schema.Type<typeof Info>

export function userAgent(client = "cli") {
  return `${Brand.slug}/${InstallationChannel}/${InstallationVersion}/${client}`
}

export const USER_AGENT = userAgent()

export function isPreview() {
  return InstallationChannel !== "latest"
}

export function isLocal() {
  return InstallationChannel === "local"
}

export class UpgradeFailedError extends Schema.TaggedErrorClass<UpgradeFailedError>()("UpgradeFailedError", {
  stderr: Schema.String,
}) {
  override get message() {
    return this.stderr
  }
}

export interface Interface {
  readonly info: () => Effect.Effect<Info>
  readonly method: () => Effect.Effect<Method>
  readonly latest: (method?: Method) => Effect.Effect<string>
  readonly upgrade: (method: Method, target: string) => Effect.Effect<void, UpgradeFailedError>
}

export interface UpdateSource {
  readonly latest: (method?: Method) => Effect.Effect<string>
  readonly upgrade: (method: Method, target: string) => Effect.Effect<void, UpgradeFailedError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Installation") {}

export const use = serviceUse(Service)

const updateUnavailable = () =>
  new UpgradeFailedError({ stderr: `${Brand.name} internal update source is not configured` })

export const disabledUpdateSource: UpdateSource = {
  latest: Effect.fn("Installation.UpdateSource.latest")(function* () {
    return InstallationVersion
  }),
  upgrade: Effect.fn("Installation.UpdateSource.upgrade")(function* () {
    return yield* updateUnavailable()
  }),
}

export function makeLayer(source: UpdateSource) {
  return Layer.succeed(
    Service,
    Service.of({
      info: Effect.fn("Installation.info")(function* () {
        return { version: InstallationVersion, latest: yield* source.latest() }
      }),
      method: Effect.fn("Installation.method")(function* () {
        return process.execPath.includes(path.join(`.${Brand.directory}`, "bin")) ? "curl" : "unknown"
      }),
      latest: source.latest,
      upgrade: source.upgrade,
    }),
  )
}

export const layer = makeLayer(disabledUpdateSource)

export const defaultLayer = layer

const { runPromise } = makeRuntime(Service, defaultLayer)

export const latest = (...args: Parameters<Interface["latest"]>) => runPromise((service) => service.latest(...args))
export const method = () => runPromise((service) => service.method())
export const upgrade = (...args: Parameters<Interface["upgrade"]>) => runPromise((service) => service.upgrade(...args))

export const node = LayerNode.make(layer, [])

export * as Installation from "."
