import { describe, expect, test } from "bun:test"
import { LLMEvent } from "@opencode-ai/llm"
import { LLMPerformance } from "@opencode-ai/core/session/runner/performance"
import { Effect, Stream } from "effect"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

describe("LLMPerformance", () => {
  test("records request size without retaining sensitive content", () => {
    const tracker = LLMPerformance.create(
      {
        requestID: "request-1",
        providerID: "internal",
        modelID: "model-1",
        sessionID: "session-1",
        agent: "build",
        mode: "primary",
        small: false,
        retries: 2,
        system: ["system-secret"],
        messages: [{ role: "user", content: "prompt-secret" }],
        tools: { private_tool: { description: "tool-secret" } },
      },
      { now: () => 1_100, started: 1_000 },
    )

    const entry = tracker.start()
    const serialized = JSON.stringify(entry)

    expect(entry).toMatchObject({
      message: "llm performance start",
      data: {
        "llm.request_id": "request-1",
        "llm.provider": "internal",
        "llm.model": "model-1",
        "session.id": "session-1",
        "llm.agent": "build",
        "llm.mode": "primary",
        "llm.small": false,
        "llm.message_count": 1,
        "llm.tool_count": 1,
        "llm.retry_limit": 2,
        "llm.preparation_ms": 100,
      },
    })
    expect(entry.data["llm.system_bytes"]).toBeGreaterThan(0)
    expect(entry.data["llm.message_bytes"]).toBeGreaterThan(0)
    expect(serialized).not.toContain("system-secret")
    expect(serialized).not.toContain("prompt-secret")
    expect(serialized).not.toContain("private_tool")
    expect(serialized).not.toContain("tool-secret")
  })

  test("measures attempts, response headers, first output, and final token throughput", () => {
    let now = 1_000
    const tracker = LLMPerformance.create(input(), { now: () => now })
    tracker.start()

    now = 1_010
    const attempt = tracker.attempt()
    expect(attempt.entry.data["llm.attempt"]).toBe(1)

    now = 1_110
    const response = tracker.response(attempt, { model: "model-1", prompt: "request-secret" })
    expect(response.data).toMatchObject({
      "llm.attempt": 1,
      "llm.response_headers_ms": 100,
    })

    now = 1_400
    const first = tracker.observe(LLMEvent.textDelta({ id: "text-1", text: "response-secret" }))
    expect(first).toHaveLength(1)
    expect(first[0]?.data).toMatchObject({
      "llm.ttft_ms": 400,
      "llm.provider_ttft_ms": 390,
      "llm.first_output_after_headers_ms": 290,
      "llm.attempt_count": 1,
      "llm.retry_count": 0,
    })

    now = 2_400
    const finish = tracker.observe(
      LLMEvent.finish({
        reason: "stop",
        usage: {
          inputTokens: 1_000,
          outputTokens: 50,
          reasoningTokens: 10,
          cacheReadInputTokens: 200,
          cacheWriteInputTokens: 100,
        },
      }),
    )
    expect(finish).toHaveLength(1)
    expect(finish[0]?.data).toMatchObject({
      "llm.total_ms": 1_400,
      "llm.generation_ms": 1_000,
      "llm.attempt_count": 1,
      "llm.retry_count": 0,
      "llm.input_tokens": 1_000,
      "llm.output_tokens": 50,
      "llm.reasoning_tokens": 10,
      "llm.cache_read_tokens": 200,
      "llm.cache_write_tokens": 100,
      "llm.output_tokens_per_second": 50,
      "llm.finish_reason": "stop",
    })
    expect(JSON.stringify([attempt, response, first, finish])).not.toContain("secret")
    expect(tracker.end()).toBeUndefined()
  })

  test("counts retries and sanitizes provider errors", () => {
    let now = 1_000
    const tracker = LLMPerformance.create(input(), { now: () => now })
    tracker.start()
    const first = tracker.attempt()
    expect(
      tracker.attemptError(first, Object.assign(new Error("attempt-secret"), { statusCode: 503 })).data,
    ).toMatchObject({
      "llm.attempt": 1,
      "llm.http_status": 503,
    })
    tracker.attempt()

    now = 1_500
    const entry = tracker.fail(Object.assign(new Error("credential-secret"), { statusCode: 429, retryable: true }))!

    expect(entry.data).toMatchObject({
      "llm.total_ms": 500,
      "llm.attempt_count": 2,
      "llm.retry_count": 1,
      "llm.http_status": 429,
      "llm.retryable": true,
      "llm.error_name": "Error",
    })
    expect(JSON.stringify(entry)).not.toContain("credential-secret")
    expect(JSON.stringify(entry)).not.toContain("attempt-secret")
    expect(tracker.end()).toBeUndefined()
  })

  test("marks abort and closed streams as interrupted without leaking messages", () => {
    const tracker = LLMPerformance.create(input(), { now: () => 1_250, started: 1_000 })
    const error = new Error("cancel-secret")
    error.name = "AbortError"

    const abort = tracker.fail(error)!
    expect(abort.data).toMatchObject({
      "llm.total_ms": 250,
      "llm.interrupted": true,
      "llm.error_name": "AbortError",
    })
    expect(JSON.stringify(abort)).not.toContain("cancel-secret")

    const closed = LLMPerformance.create(input(), { now: () => 1_250, started: 1_000 }).end()
    expect(closed?.data).toMatchObject({
      "llm.total_ms": 250,
      "llm.interrupted": true,
    })
    expect(closed?.message).toBe("llm performance interrupted")
  })

  test("never emits negative durations and records first output only once for all output types", () => {
    for (const event of [
      LLMEvent.textDelta({ id: "text-1", text: "text-secret" }),
      LLMEvent.reasoningDelta({ id: "reasoning-1", text: "reasoning-secret" }),
      LLMEvent.toolInputDelta({ id: "tool-1", name: "secret_tool", text: "tool-input-secret" }),
      LLMEvent.toolCall({ id: "tool-2", name: "secret_tool", input: "tool-call-secret" }),
    ]) {
      let now = 900
      const tracker = LLMPerformance.create(input(), { now: () => now, started: 1_000 })
      tracker.attempt()

      const first = tracker.observe(event)
      const duplicate = tracker.observe(event)

      expect(first).toHaveLength(1)
      expect(first[0]?.data["llm.ttft_ms"]).toBe(0)
      expect(duplicate).toHaveLength(0)
      expect(JSON.stringify(first)).not.toContain("secret")
    }
  })

  test("monitors successful streams without changing events", async () => {
    let now = 1_000
    const entries: LLMPerformance.Entry[] = []
    const tracker = LLMPerformance.create(input(), { now: () => now })
    const events = [
      LLMEvent.textDelta({ id: "text-1", text: "response-secret" }),
      LLMEvent.finish({ reason: "stop", usage: { outputTokens: 5 } }),
    ]

    const result = await Effect.runPromise(
      LLMPerformance.monitor(Stream.fromIterable(events), tracker, (entry) =>
        Effect.sync(() => {
          entries.push(entry)
          now += 100
        }),
      ).pipe(Stream.runCollect),
    )

    expect(Array.from(result)).toEqual(events)
    expect(entries.map((entry) => entry.message)).toEqual([
      "llm performance start",
      "llm performance attempt",
      "llm performance first output",
      "llm performance finish",
    ])
    expect(JSON.stringify(entries)).not.toContain("response-secret")
  })

  test("monitors failed streams with sanitized errors", async () => {
    const entries: LLMPerformance.Entry[] = []
    const tracker = LLMPerformance.create(input(), { now: () => 1_000 })

    let failed = false
    try {
      await Effect.runPromise(
        LLMPerformance.monitor(
          Stream.fail(Object.assign(new Error("provider-secret"), { statusCode: 502, retryable: true })),
          tracker,
          (entry) =>
            Effect.sync(() => {
              entries.push(entry)
            }),
        ).pipe(Stream.runCollect),
      )
    } catch {
      failed = true
    }
    expect(failed).toBe(true)

    expect(entries.map((entry) => entry.message)).toEqual([
      "llm performance start",
      "llm performance attempt",
      "llm performance error",
    ])
    expect(entries.at(-1)?.data).toMatchObject({
      "llm.http_status": 502,
      "llm.retryable": true,
    })
    expect(JSON.stringify(entries)).not.toContain("provider-secret")
  })

  test("V2 runner wraps the provider stream at the LLM boundary", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/session/runner/llm.ts", import.meta.url)), "utf8")

    expect(source).toContain('from "./performance"')
    expect(source).toContain("LLMPerformance.monitor(llm.stream(request), performance, logPerformance)")
    expect(source).toContain("requestID: randomUUID()")
  })
})

function input() {
  return {
    requestID: "request-1",
    providerID: "internal",
    modelID: "model-1",
    sessionID: "session-1",
    agent: "build",
    mode: "primary",
    small: false,
    retries: 2,
    system: ["system"],
    messages: [{ role: "user", content: "prompt" }],
    tools: {},
  }
}
