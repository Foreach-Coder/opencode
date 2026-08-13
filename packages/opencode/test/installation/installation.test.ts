import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Installation } from "../../src/installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Brand } from "@opencode-ai/brand"
import { testEffect } from "../lib/effect"

const it = testEffect(Installation.layer)

describe("installation", () => {
  it.effect("reports the bundled version without contacting an update source", () =>
    Effect.gen(function* () {
      expect(yield* Installation.use.latest()).toBe(InstallationVersion)
      expect(yield* Installation.use.info()).toEqual({
        version: InstallationVersion,
        latest: InstallationVersion,
      })
    }),
  )

  it.effect("fails closed when an upgrade is requested", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Installation.use.upgrade("curl", "9.9.9"))
      expect(error).toBeInstanceOf(Installation.UpgradeFailedError)
      expect(error.message).toBe(`${Brand.name} internal update source is not configured`)
    }),
  )

  testEffect(
    Installation.makeLayer({
      latest: () => Effect.succeed("2.0.0"),
      upgrade: () => Effect.void,
    }),
  ).effect("keeps the update source injectable for an internal release service", () =>
    Effect.gen(function* () {
      expect(yield* Installation.use.latest()).toBe("2.0.0")
      expect(yield* Installation.use.info()).toEqual({ version: InstallationVersion, latest: "2.0.0" })
    }),
  )
})
