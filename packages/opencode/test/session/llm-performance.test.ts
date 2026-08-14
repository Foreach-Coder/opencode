import { describe, expect, test } from "bun:test"
import { LLMEvent } from "@opencode-ai/llm"
import { LLMPerformance } from "@/session/llm/performance"

describe("LLM performance diagnostics", () => {
  test("records request size without retaining sensitive content", () => {
    const now = 1_100
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
      { now: () => now, started: 1_000 },
    )

    const entry = tracker.start()
    const serialized = JSON.stringify(entry)

    expect(entry.data).toMatchObject({
      "llm.request_id": "request-1",
      "llm.provider": "internal",
      "llm.model": "model-1",
      "llm.message_count": 1,
      "llm.tool_count": 1,
      "llm.retry_limit": 2,
      "llm.preparation_ms": 100,
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
    expect(first[0].data).toMatchObject({
      "llm.ttft_ms": 400,
      "llm.provider_ttft_ms": 390,
      "llm.first_output_after_headers_ms": 290,
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
    expect(finish[0].data).toMatchObject({
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
    const error = Object.assign(new Error("credential-secret"), { statusCode: 429, retryable: true })
    const entry = tracker.fail(error)!

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

  test("marks a stream that ends without finish or error as interrupted", () => {
    let now = 1_000
    const tracker = LLMPerformance.create(input(), { now: () => now })
    tracker.start()
    now = 1_250

    expect(tracker.end()?.data).toMatchObject({
      "llm.total_ms": 250,
      "llm.interrupted": true,
    })
    expect(tracker.end()).toBeUndefined()
  })

  test("classifies abort errors without retaining their message", () => {
    const tracker = LLMPerformance.create(input())
    const error = new Error("cancel-secret")
    error.name = "AbortError"

    const entry = tracker.fail(error)!

    expect(entry.data["llm.interrupted"]).toBe(true)
    expect(JSON.stringify(entry)).not.toContain("cancel-secret")
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
