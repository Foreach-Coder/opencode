import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Npm } from "@opencode-ai/core/npm"
import { Account } from "../../src/account/account"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Env } from "../../src/env"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"
import { disposeAllInstances, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const unexpectedHttp = HttpClient.make((request) =>
  Effect.die(`unexpected http request: ${request.method} ${request.url}`),
)

const configLayer = (auth = AuthTest.empty, client = unexpectedHttp) =>
  LayerNode.compile(LayerNode.group([Config.node, FSUtil.node, Env.node, CrossSpawnSpawner.node]), [
    [Auth.node, auth],
    [Account.node, AccountTest.empty],
    [Npm.node, NpmTest.noop],
    [httpClient, Layer.succeed(HttpClient.HttpClient, client)],
  ])

const withGlobalConfigDir = <A, E, R>(dir: string, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Global.Path.config
      ;(Global.Path as { config: string }).config = dir
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        ;(Global.Path as { config: string }).config = previous
      }),
  )

const withManagedConfigDir = <A, E, R>(dir: string, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR
      process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR = dir
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR
        else process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR = previous
      }),
  )

const admin = {
  model: "admin/good",
  small_model: "admin/small",
  enabled_providers: ["admin"],
  disabled_providers: ["disabled-by-admin"],
  provider: {
    admin: {
      npm: "@ai-sdk/openai-compatible",
      name: "Admin",
      options: { baseURL: "https://admin.invalid/v1" },
      models: {
        good: { name: "Good" },
        small: { name: "Small" },
      },
    },
  },
}

afterEach(async () => {
  delete process.env.OPENCODE_CONFIG_CONTENT
  delete process.env.ADMIN_MODEL
  delete process.env.ADMIN_BASE_URL
  await disposeAllInstances()
})

describe("admin provider source isolation", () => {
  testEffect(configLayer()).instance("managed config cannot add or override provider policy", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      const managed = yield* tmpdirScoped()
      yield* Effect.promise(() => Bun.write(path.join(global, "opencode.json"), JSON.stringify(admin)))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(managed, "opencode.json"),
          JSON.stringify({
            model: "managed/model",
            enabled_providers: ["managed"],
            disabled_providers: ["admin"],
            provider: {
              admin: {
                npm: "managed-package",
                options: { baseURL: "https://managed.invalid" },
                models: { injected: { name: "Injected" } },
              },
              managed: { npm: "managed-package", models: { model: { name: "Managed" } } },
            },
          }),
        ),
      )

      yield* withManagedConfigDir(
        managed,
        withGlobalConfigDir(
          global,
          Effect.gen(function* () {
            const svc = yield* Config.Service
            const merged = yield* svc.get()
            const isolated = yield* svc.getAdminProviderConfig()

            expect(merged.model).toBe("managed/model")
            expect(merged.provider?.managed).toBeDefined()
            expect(isolated).toEqual(admin)
          }),
        ),
      )
    }),
  )

  testEffect(configLayer()).instance("environment substitutions cannot rewrite provider policy", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      process.env.ADMIN_MODEL = "attacker/model"
      process.env.ADMIN_BASE_URL = "https://attacker.invalid"
      yield* Effect.promise(() =>
        Bun.write(
          path.join(global, "opencode.json"),
          JSON.stringify({
            model: "{env:ADMIN_MODEL}",
            provider: {
              admin: {
                npm: "@ai-sdk/openai-compatible",
                options: { baseURL: "{env:ADMIN_BASE_URL}" },
                models: { good: { name: "Good" } },
              },
            },
          }),
        ),
      )

      yield* withGlobalConfigDir(
        global,
        Config.Service.use((svc) =>
          Effect.gen(function* () {
            const isolated = yield* svc.getAdminProviderConfig()
            expect(isolated.model).toBe("{env:ADMIN_MODEL}")
            expect(isolated.provider?.admin?.options?.baseURL).toBe("{env:ADMIN_BASE_URL}")
          }),
        ),
      )
    }),
  )

  testEffect(configLayer()).instance("environment config content cannot add or override provider policy", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      yield* Effect.promise(() => Bun.write(path.join(global, "opencode.json"), JSON.stringify(admin)))
      process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
        model: "attacker/model",
        small_model: "attacker/small",
        enabled_providers: ["attacker"],
        disabled_providers: ["admin"],
        provider: {
          admin: {
            npm: "attacker-package",
            options: { baseURL: "https://attacker.invalid" },
            models: { injected: { name: "Injected" } },
          },
          attacker: {
            npm: "attacker-package",
            models: { model: { name: "Attacker" }, small: { name: "Attacker Small" } },
          },
        },
      })

      yield* withGlobalConfigDir(
        global,
        Effect.gen(function* () {
          const svc = yield* Config.Service
          const merged = yield* svc.get()
          const isolated = yield* svc.getAdminProviderConfig()

          expect(merged.model).toBe("attacker/model")
          expect(merged.provider?.attacker).toBeDefined()
          expect(isolated).toEqual(admin)
        }),
      )
    }),
  )

  const origin = "https://policy.example.com"
  const seen: string[] = []
  const auth = Layer.mock(Auth.Service)({
    all: () =>
      Effect.succeed({
        [origin]: new Auth.WellKnown({ type: "wellknown", key: "ADMIN_TOKEN", token: "secret" }),
      }),
  })
  const client = HttpClient.make((request) => {
    seen.push(request.url)
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(
          JSON.stringify({
            config: {
              model: "remote/model",
              enabled_providers: ["remote"],
              disabled_providers: ["admin"],
              provider: {
                admin: { npm: "remote-package", options: { baseURL: "https://remote.invalid" } },
                remote: { npm: "remote-package", models: { model: { name: "Remote" } } },
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    )
  })

  testEffect(configLayer(auth, client)).instance("well-known config cannot add or override provider policy", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      yield* Effect.promise(() => Bun.write(path.join(global, "opencode.json"), JSON.stringify(admin)))

      yield* withGlobalConfigDir(
        global,
        Effect.gen(function* () {
          const svc = yield* Config.Service
          const merged = yield* svc.get()
          const isolated = yield* svc.getAdminProviderConfig()

          expect(seen).toContain(`${origin}/.well-known/opencode`)
          expect(merged.provider?.remote).toBeDefined()
          expect(isolated).toEqual(admin)
        }),
      )
    }),
  )
})
