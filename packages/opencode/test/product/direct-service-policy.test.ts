import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer, Ref, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { httpClient, LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Otlp } from "@opencode-ai/core/observability/otlp"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Installation } from "../../src/installation"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Session } from "../../src/session/session"
import { SessionID } from "../../src/session/schema"
import { SessionShare } from "../../src/share/session"
import { ShareNext } from "../../src/share/share-next"
import { TestConfig } from "../fixture/config"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const readOptional = (file: string) =>
  Effect.promise(() =>
    Bun.file(file)
      .text()
      .catch(() => undefined),
  )

function expectPolicy<A, E>(exit: Exit.Exit<A, E>, code: string) {
  expect(Exit.isFailure(exit)).toBeTrue()
  if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain(code)
}

afterEach(() => {
  Flag.OTEL_EXPORTER_OTLP_ENDPOINT = undefined
})

describe("direct write service boundaries", () => {
  testEffect(LayerNode.compile(Auth.node)).live("Auth.set/remove reject before persistence", () =>
    Effect.gen(function* () {
      const svc = yield* Auth.Service
      const file = path.join(Global.Path.data, "auth.json")
      const before = yield* readOptional(file)
      const set = yield* Effect.exit(svc.set("attacker", new Auth.Api({ type: "api", key: "secret" })))
      const remove = yield* Effect.exit(svc.remove("existing"))

      expectPolicy(set, "PROVIDER_MANAGED_BY_ADMIN")
      expectPolicy(remove, "PROVIDER_MANAGED_BY_ADMIN")
      expect(yield* readOptional(file)).toBe(before)
    }),
  )

  testEffect(LayerNode.compile(Config.node)).instance("Config.update/updateGlobal reject before persistence", () =>
    Effect.gen(function* () {
      const svc = yield* Config.Service
      const dir = (yield* TestInstance).directory
      const local = path.join(dir, "config.json")
      const global = path.join(Global.Path.config, "opencode.jsonc")
      const beforeLocal = yield* readOptional(local)
      const beforeGlobal = yield* readOptional(global)
      const update = yield* Effect.exit(svc.update({ model: "attacker/model" }))
      const updateGlobal = yield* Effect.exit(svc.updateGlobal({ model: "attacker/model" }))

      expectPolicy(update, "CONFIG_WRITE_DISABLED")
      expectPolicy(updateGlobal, "CONFIG_WRITE_DISABLED")
      expect(yield* readOptional(local)).toBe(beforeLocal)
      expect(yield* readOptional(global)).toBe(beforeGlobal)
    }),
  )

  const shareCalls: string[] = []
  const shareLayer = LayerNode.compile(SessionShare.node, [
    [Config.node, TestConfig.layer({ get: () => Effect.succeed({ share: "manual" }) })],
    [
      Session.node,
      Layer.mock(Session.Service)({
        setShare: () => Effect.sync(() => shareCalls.push("session.setShare")),
      }),
    ],
    [
      ShareNext.node,
      Layer.mock(ShareNext.Service)({
        create: () =>
          Effect.sync(() => shareCalls.push("share.create")).pipe(
            Effect.as({ id: "never", url: "never", secret: "never" }),
          ),
        remove: () => Effect.sync(() => shareCalls.push("share.remove")),
      }),
    ],
    [RuntimeFlags.node, RuntimeFlags.layer()],
  ])

  testEffect(shareLayer).live("SessionShare.share/unshare reject before share persistence or network", () =>
    Effect.gen(function* () {
      shareCalls.length = 0
      const svc = yield* SessionShare.Service
      const sessionID = SessionID.make("ses_00000000000000000000000000")
      const share = yield* Effect.exit(svc.share(sessionID))
      const unshare = yield* Effect.exit(svc.unshare(sessionID))

      expectPolicy(share, "PUBLIC_SHARE_DISABLED")
      expectPolicy(unshare, "PUBLIC_SHARE_DISABLED")
      expect(shareCalls).toEqual([])
    }),
  )
})

describe("direct public network service boundaries", () => {
  const updateCalls: string[] = []
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      updateCalls.push(`http:${request.url}`)
      return HttpClientResponse.fromWeb(request, new Response("{}", { status: 200 }))
    }),
  )
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.sync(() => {
      updateCalls.push(`spawn:${ChildProcess.isStandardCommand(command) ? command.command : "shell"}`)
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as never,
        stdout: Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as never,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      })
    }),
  )
  const spawnerNode = makeGlobalNode({
    service: ChildProcessSpawner.ChildProcessSpawner,
    layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
    deps: [],
  })
  const installationLayer = LayerNode.compile(Installation.node, [
    [httpClient, Layer.succeed(HttpClient.HttpClient, client)],
    [CrossSpawnSpawner.node, spawnerNode],
  ])

  testEffect(installationLayer).live("Installation.latest/upgrade reject before HTTP or process execution", () =>
    Effect.gen(function* () {
      updateCalls.length = 0
      const svc = yield* Installation.Service
      const latest = yield* Effect.exit(svc.latest("npm"))
      const upgrade = yield* Effect.exit(svc.upgrade("npm", "9.9.9"))

      expectPolicy(latest, "PUBLIC_UPDATE_DISABLED")
      expectPolicy(upgrade, "PUBLIC_UPDATE_DISABLED")
      expect(updateCalls).toEqual([])
    }),
  )

  test("ModelsDev.refresh rejects the policy error without touching HttpClient", async () => {
    const calls = await Effect.runPromise(Ref.make<string[]>([]))
    const modelClient = HttpClient.make((request) =>
      Ref.update(calls, (items) => [...items, request.url]).pipe(
        Effect.as(HttpClientResponse.fromWeb(request, new Response("{}", { status: 200 }))),
      ),
    )
    const layer = Layer.fresh(
      AppNodeBuilder.build(ModelsDev.node, [
        [LayerNodePlatform.httpClient, Layer.succeed(HttpClient.HttpClient, modelClient)],
      ]),
    )
    const exit = await Effect.runPromise(
      ModelsDev.Service.use((svc) => Effect.exit(svc.refresh(true))).pipe(Effect.scoped, Effect.provide(layer)),
    )

    expectPolicy(exit, "PRODUCT_CAPABILITY_DISABLED")
    expect(await Effect.runPromise(Ref.get(calls))).toEqual([])
  })

  test("OTLP logger and tracing exits reject before exporter construction", async () => {
    Flag.OTEL_EXPORTER_OTLP_ENDPOINT = "https://telemetry.invalid"

    expect(() => Otlp.loggers()).toThrow("PRODUCT_CAPABILITY_DISABLED: 遥测网络已由产品策略禁用")
    await expect(Otlp.tracingLayer()).rejects.toThrow("PRODUCT_CAPABILITY_DISABLED: 遥测网络已由产品策略禁用")
  })
})
