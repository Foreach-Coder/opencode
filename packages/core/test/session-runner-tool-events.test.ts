import { expect, test } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionV2 } from "@opencode-ai/core/session"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { createLLMEventPublisher } from "@opencode-ai/core/session/runner/publish-llm-event"

const sessionID = SessionV2.ID.make("ses_tool_event_test")
const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"

const capture = () => {
  const published: Array<{ readonly type: string; readonly data: unknown }> = []
  const events = EventV2.Service.of({
    publish: (definition, data) =>
      Effect.sync(() => {
        const event = { id: EventV2.ID.create(), type: definition.type, data } as EventV2.Payload<typeof definition>
        published.push({
          type: definition.durable
            ? EventV2.versionedType(definition.type, definition.durable.version)
            : definition.type,
          data,
        })
        return event
      }),
    subscribe: () => Stream.empty,
    all: () => Stream.empty,
    durable: () => Stream.empty,
    listen: () => Effect.succeed(Effect.void),
    project: () => Effect.void,
    replay: () => Effect.void,
    replayAll: () => Effect.succeed(undefined),
    remove: () => Effect.void,
    claim: () => Effect.void,
  })
  return {
    published,
    publisher: createLLMEventPublisher(events, {
      sessionID,
      agent: "build",
      model: {
        id: ModelV2.ID.make("model"),
        providerID: ProviderV2.ID.make("provider"),
      },
    }),
  }
}

const record = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}

const reasoningEvents = (events: ReadonlyArray<{ readonly type: string; readonly data: unknown }>) =>
  events
    .filter((event) => event.type.includes("reasoning"))
    .map((event) => ({
      type: event.type,
      id: record(event.data).reasoningID,
      text: record(event.data).text,
      delta: record(event.data).delta,
      metadata: record(event.data).providerMetadata,
    }))

const call = LLMEvent.toolCall({ id: "call-image", name: "read", input: { path: "pixel.png" } })
const result = LLMEvent.toolResult({
  id: "call-image",
  name: "read",
  result: {
    type: "content",
    value: [
      { type: "text", text: "Image read successfully" },
      { type: "file", uri: `data:image/png;base64,${base64}`, mime: "image/png", name: "pixel.png" },
    ],
  },
  output: {
    structured: { type: "media", mime: "image/png" },
    content: [
      { type: "text", text: "Image read successfully" },
      { type: "file", uri: `data:image/png;base64,${base64}`, mime: "image/png", name: "pixel.png" },
    ],
  },
})

test("local tool success serializes media base64 once and reconstructs from structured content", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(publisher.publish(call))
  await Effect.runPromise(publisher.publish(result))

  const success = published.find((event) => event.type === "session.next.tool.success.1")
  expect(success).toBeDefined()
  const serialized = JSON.stringify(success)
  expect(serialized.split(base64)).toHaveLength(2)
  expect(success?.data).not.toHaveProperty("result")

  expect(success?.data).toMatchObject({
    content: [
      { type: "text", text: "Image read successfully" },
      { type: "file", uri: `data:image/png;base64,${base64}`, mime: "image/png" },
    ],
  })
})

test("provider-executed success retains its compatibility result", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(publisher.publish(LLMEvent.toolCall({ ...call, providerExecuted: true })))
  await Effect.runPromise(publisher.publish(LLMEvent.toolResult({ ...result, providerExecuted: true })))
  const success = published.find((event) => event.type === "session.next.tool.success.1")
  expect(success?.data).toHaveProperty("result")
})

test("binary failure emits no success event", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(publisher.publish(call))
  await Effect.runPromise(
    publisher.publish(
      LLMEvent.toolResult({
        id: call.id,
        name: call.name,
        result: { type: "error", value: "Cannot read binary file" },
      }),
    ),
  )
  expect(published.some((event) => event.type === "session.next.tool.success.1")).toBe(false)
  expect(published.some((event) => event.type === "session.next.tool.failed.1")).toBe(true)
})

test("old success event data containing result still decodes", () => {
  const decoded = Schema.decodeUnknownSync(SessionEvent.Tool.Success.data)({
    sessionID,
    timestamp: Date.now(),
    assistantMessageID: SessionMessage.ID.create(),
    callID: "call-old",
    structured: { type: "media", mime: "image/png" },
    content: [{ type: "file", uri: `data:image/png;base64,${base64}`, mime: "image/png" }],
    result: { type: "content", value: [{ type: "file", uri: `data:image/png;base64,${base64}`, mime: "image/png" }] },
    provider: { executed: false },
  })
  expect(decoded.result).toMatchObject({ type: "content" })
})

test("step finish records settlement without publishing step ended", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(publisher.publish(LLMEvent.stepStart({ index: 0 })))
  await Effect.runPromise(publisher.publish(LLMEvent.stepFinish({ index: 0, reason: "stop" })))

  expect(published.some((event) => event.type === "session.next.step.ended.2")).toBe(false)
  expect(publisher.stepSettlement()).toMatchObject({ finish: "stop" })
})

test("merges adjacent unsigned reasoning lifecycles before publishing a boundary", async () => {
  const { published, publisher } = capture()
  for (const event of [
    LLMEvent.reasoningStart({ id: "reasoning-1" }),
    LLMEvent.reasoningDelta({ id: "reasoning-1", text: "我" }),
    LLMEvent.reasoningEnd({ id: "reasoning-1" }),
    LLMEvent.reasoningStart({ id: "reasoning-2" }),
    LLMEvent.reasoningDelta({ id: "reasoning-2", text: "先" }),
    LLMEvent.reasoningEnd({ id: "reasoning-2" }),
    LLMEvent.reasoningStart({ id: "reasoning-3" }),
    LLMEvent.reasoningDelta({ id: "reasoning-3", text: "分析" }),
    LLMEvent.reasoningEnd({ id: "reasoning-3" }),
    LLMEvent.textStart({ id: "text-1" }),
  ]) {
    await Effect.runPromise(publisher.publish(event))
  }
  await Effect.runPromise(publisher.flush())

  expect(reasoningEvents(published)).toEqual([
    {
      type: "session.next.reasoning.started.1",
      id: "reasoning-1",
      text: undefined,
      delta: undefined,
      metadata: undefined,
    },
    { type: "session.next.reasoning.delta", id: "reasoning-1", text: undefined, delta: "我", metadata: undefined },
    { type: "session.next.reasoning.delta", id: "reasoning-1", text: undefined, delta: "先", metadata: undefined },
    { type: "session.next.reasoning.delta", id: "reasoning-1", text: undefined, delta: "分析", metadata: undefined },
    {
      type: "session.next.reasoning.ended.1",
      id: "reasoning-1",
      text: "我先分析",
      delta: undefined,
      metadata: undefined,
    },
  ])
})

test("keeps signed reasoning blocks independent while merging unsigned fragments", async () => {
  const { published, publisher } = capture()
  for (const event of [
    LLMEvent.reasoningStart({ id: "reasoning-1" }),
    LLMEvent.reasoningDelta({ id: "reasoning-1", text: "我" }),
    LLMEvent.reasoningEnd({ id: "reasoning-1" }),
    LLMEvent.reasoningStart({ id: "reasoning-2" }),
    LLMEvent.reasoningDelta({ id: "reasoning-2", text: "先" }),
    LLMEvent.reasoningEnd({ id: "reasoning-2" }),
    LLMEvent.reasoningStart({
      id: "reasoning-3",
      providerMetadata: { anthropic: { signature: "signature-1" } },
    }),
    LLMEvent.reasoningDelta({ id: "reasoning-3", text: "复查" }),
    LLMEvent.reasoningEnd({
      id: "reasoning-3",
      providerMetadata: { anthropic: { signature: "signature-1" } },
    }),
  ]) {
    await Effect.runPromise(publisher.publish(event))
  }
  await Effect.runPromise(publisher.flush())

  expect(reasoningEvents(published)).toEqual([
    {
      type: "session.next.reasoning.started.1",
      id: "reasoning-1",
      text: undefined,
      delta: undefined,
      metadata: undefined,
    },
    { type: "session.next.reasoning.delta", id: "reasoning-1", text: undefined, delta: "我", metadata: undefined },
    { type: "session.next.reasoning.delta", id: "reasoning-1", text: undefined, delta: "先", metadata: undefined },
    {
      type: "session.next.reasoning.ended.1",
      id: "reasoning-1",
      text: "我先",
      delta: undefined,
      metadata: undefined,
    },
    {
      type: "session.next.reasoning.started.1",
      id: "reasoning-3",
      text: undefined,
      delta: undefined,
      metadata: { anthropic: { signature: "signature-1" } },
    },
    { type: "session.next.reasoning.delta", id: "reasoning-3", text: undefined, delta: "复查", metadata: undefined },
    {
      type: "session.next.reasoning.ended.1",
      id: "reasoning-3",
      text: "复查",
      delta: undefined,
      metadata: { anthropic: { signature: "signature-1" } },
    },
  ])
})
